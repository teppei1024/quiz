import { useState, useEffect } from 'react';
import { db } from './firebase';
import { collection, query, where, getDocs, doc, getDoc } from 'firebase/firestore';

export function useTestRange(userId: string | undefined, overrideGrade?: string) {
  const [testRangeUnitIds, setTestRangeUnitIds] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function fetchTestRange() {
      if (!userId) {
        setLoading(false);
        return;
      }

      try {
        setLoading(true);
        // 1. ユーザーの学年情報を取得
        const userDocRef = doc(db, 'users', userId);
        const userDocSnap = await getDoc(userDocRef);
        
        if (!userDocSnap.exists()) {
          throw new Error('ユーザー情報が見つかりません');
        }
        
        const userData = userDocSnap.data();
        
        // ★本来の学年を overrideGrade があれば優先して使用する★
        const grade = overrideGrade || userData.grade; // 例: "j1", "j2"

        if (!grade) {
          throw new Error('学年が設定されていません');
        }

        // 2. ラーニングサイトの lessons コレクションから、自分の学年がテスト範囲に含まれるレッスンを取得
        const lessonsRef = collection(db, 'lessons');
        // examTargetGrades（配列）に自分のgradeが含まれるものをクエリで検索
        const q = query(lessonsRef, where('examTargetGrades', 'array-contains', grade));
        const querySnapshot = await getDocs(q);

        const targetUnits: string[] = [];
        querySnapshot.forEach((docSnap) => {
          const lessonData = docSnap.data();
          // ラーニングサイトのlessonのtitleから、先頭の半角英数字（例: "1-1 符号のついた数" -> "1-1", "RL リーディング" -> "RL"）を抽出する
          const match = lessonData.title.match(/^([a-zA-Z0-9]+(?:-[a-zA-Z0-9]+)*)/);
          if (match && match[1]) {
            targetUnits.push(match[1]); // 例: "1-1"
          }
        });

        setTestRangeUnitIds(targetUnits);
        setError(null);
      } catch (err: any) {
        console.error('テスト範囲の取得エラー:', err);
        setError(err.message || 'テスト範囲の取得に失敗しました');
      } finally {
        setLoading(false);
      }
    }

    fetchTestRange();
  }, [userId, overrideGrade]);

  return { testRangeUnitIds, loading, error };
}
