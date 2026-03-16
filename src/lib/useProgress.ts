import { db } from "./firebase";
import { doc, getDoc, setDoc, updateDoc, increment, collection, query, orderBy, limit, getDocs } from "firebase/firestore";

// ユーザーの各問題に対する学習状況の型定義
export interface QuizProgress {
  quizId: string;
  status: "new" | "learning" | "review" | "mastered"; 
  nextReviewDate: string; // ISOString形式 (例 "2024-03-15T00:00:00Z")
  interval: number; // 現在の復習間隔（日数）
  lastEvaluatedAt: string; // 最後に評価した日時
  isSameDayRetry: boolean; // 当日中の×による2周目フラグ
}

// 評価ボタンの種類
export type EvaluationResult = "master" | "circle" | "triangle" | "cross";

/**
 * 特定のユーザーの特定の問題に関する学習履歴を取得する
 */
export async function getQuizProgress(userId: string, quizId: string): Promise<QuizProgress | null> {
  const docRef = doc(db, "users", userId, "progress", quizId);
  const docSnap = await getDoc(docRef);

  if (docSnap.exists()) {
    return docSnap.data() as QuizProgress;
  }
  return null;
}

/**
 * ユーザーの全ての学習履歴を取得する（ダッシュボード・レーダーチャート用）
 */
export async function getAllProgress(userId: string): Promise<QuizProgress[]> {
  try {
    const progressRef = collection(db, "users", userId, "progress");
    const querySnapshot = await getDocs(progressRef);
    
    return querySnapshot.docs.map(doc => doc.data() as QuizProgress);
  } catch (error: any) {
    if (error?.code === "permission-denied") {
      console.warn("全進捗取得: permission-denied (権限がないためスキップします)");
    } else {
      console.error("全進捗取得エラー:", error);
    }
    return []; // エラー時は空配列を返すことでUIクラッシュを防ぐ
  }
}

/**
 * 評価結果に基づいて学習スケジュールを計算し、Firebaseに保存する
 * @param userId ユーザーID
 * @param quizId スプレッドシートの該当問題ID
 * @param evalType 押されたボタン(◎, 〇, △, ×)
 * @param currentProgress 現在の学習状況(あれば)
 */
export async function saveEvaluation(
  userId: string,
  quizId: string,
  evalType: EvaluationResult,
  currentProgress?: QuizProgress | null
): Promise<QuizProgress> {
  
  const now = new Date();
  let nextDate = new Date();
  let newStatus: QuizProgress["status"] = "review";
  let newInterval = 0;
  let isSameDayRetry = false;

  // --- スコア計算ロジック（ランキング用） ---
  let scoreToAdd = 0;
  if (evalType === "master") {
    scoreToAdd += 3; // 基礎スコア
    if (currentProgress?.status === "learning") scoreToAdd += 10; // 成長ボーナス（×を◎にした）
  } else if (evalType === "circle") {
    scoreToAdd += 2; // 基礎スコア
    if (currentProgress?.status === "learning") scoreToAdd += 5;  // 成長ボーナス（×を〇にした）
  }

  // デフォルト値(初回解答時)
  const prevInterval = currentProgress?.interval || 0;
  const wasSameDayRetry = currentProgress?.isSameDayRetry || false;

  // --- スケジュール計算ロジック ---
  switch (evalType) {
    case "master": // ◎ 超完璧
      newStatus = "mastered";
      // 二度と出ないように遠い未来に設定 (2099年)
      nextDate = new Date("2099-12-31T00:00:00Z");
      newInterval = 999;
      break;

    case "circle": // 〇 正解
      if (wasSameDayRetry) {
        // ×の後の当日中の2周目で〇を引いた場合 → 強制的に翌日出題
        nextDate.setDate(now.getDate() + 1);
        newInterval = 1;
      } else {
        // 通常の〇
        newInterval = prevInterval === 0 ? 7 : (prevInterval === 7 ? 14 : 30);
        nextDate.setDate(now.getDate() + newInterval);
      }
      break;

    case "triangle": // △ 惜しい
      if (wasSameDayRetry) {
        // 当日2周目で△ → 強制的に翌日 (〇と同じ扱い、もしくは当日中にループさせることも可能だが今回は翌日)
        nextDate.setDate(now.getDate() + 1);
        newInterval = 1;
      } else {
        newInterval = 3;
        nextDate.setDate(now.getDate() + newInterval);
      }
      break;

    case "cross": // × 不正解
      newStatus = "learning";
      newInterval = 0;
      isSameDayRetry = true;
      // 当日中に再出題するため、次回の時間を現在時刻と同じ(=すぐ出題対象になる)にする
      // ※リストの最後尾に回るロジックは表示側(page.tsx)で実装します
      nextDate = now; 
      break;
  }

  // --- 保存するデータを作成 ---
  const newProgress: QuizProgress = {
    quizId,
    status: newStatus,
    nextReviewDate: nextDate.toISOString(),
    interval: newInterval,
    lastEvaluatedAt: now.toISOString(),
    isSameDayRetry
  };

  // --- Firestore に保存 ---
  const docRef = doc(db, "users", userId, "progress", quizId);
  await setDoc(docRef, newProgress);

  // --- スコアを加算 ---
  if (scoreToAdd > 0) {
    const userRef = doc(db, "users", userId);
    try {
      await updateDoc(userRef, {
        totalScore: increment(scoreToAdd)
      });
    } catch (e: any) {
      if (e.code === 'not-found') {
         await setDoc(userRef, { totalScore: scoreToAdd }, { merge: true });
      } else {
         console.error('スコア加算エラー', e);
      }
    }
  }

  return newProgress;
}

/**
 * ランキングデータ（トップユーザー一覧）を取得する
 */
export async function getLeaderboard(limitNum = 10) {
  try {
    const usersRef = collection(db, "users");
    const q = query(usersRef, orderBy("totalScore", "desc"), limit(limitNum));
    const querySnapshot = await getDocs(q);
    
    // TotalScoreが存在するユーザーだけを抽出
    const leaderboard = querySnapshot.docs.map(doc => {
      const data = doc.data();
      return {
        uid: doc.id,
        displayName: data.displayName || "名無し",
        totalScore: data.totalScore || 0,
        grade: data.grade || "",
        photoURL: data.photoURL || null
      };
    }).filter(user => user.totalScore > 0);
    
    return leaderboard;
  } catch (error: any) {
    if (error?.code === "permission-denied") {
      console.warn("ランキング取得: permission-denied (権限がないためスキップします)");
    } else {
      console.error("ランキング取得エラー:", error);
    }
    return []; // エラー時は空配列を返すことでクラッシュを防ぐ
  }
}
