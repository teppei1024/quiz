"use client";

import React, { useState, useRef, useEffect } from "react";
import { useAuth } from "@/lib/useAuth";
import { useQuizData, QuizData } from "@/lib/useQuizData";
import { getQuizProgress, saveEvaluation, QuizProgress, EvaluationResult } from "@/lib/useProgress";
import { useTestRange } from "@/lib/useTestRange";
import LoginScreen from "@/components/LoginScreen";
import { useRouter, useSearchParams } from "next/navigation";

import { Suspense } from "react";

function QuizAppContent() {
  const { user, loading: authLoading } = useAuth();
  const router = useRouter();

  const searchParams = useSearchParams();
  const initialGrade = searchParams.get("grade") || "";

  // ★学年お試し機能: UIで選択された学年を保持するState
  const [overrideGrade, setOverrideGrade] = useState<string>(initialGrade);

  const { testRangeUnitIds, loading: testRangeLoading } = useTestRange(user?.uid, overrideGrade);
  const { quizzes, loading: quizLoading, error } = useQuizData();
  const [showAnswer, setShowAnswer] = useState(false);
  
  // インチキ防止（時間計測）用のRef
  const questionStartTimeRef = useRef<number>(0);
  const answerShowTimeRef = useRef<number>(0);

  // 学習ロジック用のState
  const [dailyQuizzes, setDailyQuizzes] = useState<QuizData[]>([]);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [progressData, setProgressData] = useState<Record<string, QuizProgress>>({});
  const [isReady, setIsReady] = useState(false);

  // 音声読み上げ用
  const synthRef = useRef<SpeechSynthesis | null>(null);
  const [voices, setVoices] = useState<SpeechSynthesisVoice[]>([]);

  const cardRef = useRef<HTMLDivElement>(null);

  // コンポーネントマウント時にSpeechSynthesisを初期化
  useEffect(() => {
    if (typeof window !== "undefined" && window.speechSynthesis) {
      synthRef.current = window.speechSynthesis;
      // 音声リストのロードを待つ
      const loadVoices = () => setVoices(synthRef.current!.getVoices());
      loadVoices();
      if (speechSynthesis.onvoiceschanged !== undefined) {
        speechSynthesis.onvoiceschanged = loadVoices;
      }
    }
  }, []);

  // 問題が切り替わった（表示された）タイミングで開始時刻を記録
  useEffect(() => {
    if (isReady && dailyQuizzes.length > 0) {
      questionStartTimeRef.current = Date.now();
    }
  }, [currentIndex, isReady, dailyQuizzes]);

  // マウント時＆データ取得後に「今日やるべき問題」をフィルタリングする
  useEffect(() => {
    async function prepareDailyQuizzes() {
      // 全データのロードとテスト範囲の取得が完了するまで待機
      if (!user || quizzes.length === 0 || testRangeLoading) return;

      const now = new Date();
      const tempProgressData: Record<string, QuizProgress> = {};
      const targetQuizzes: QuizData[] = [];
      const reviewQuizzes: QuizData[] = []; // すでに×を出して復習待ちのもの

      for (const quiz of quizzes) {
        // ★テスト範囲連動: 取得したテスト範囲(testRangeUnitIds)に含まれる単元の問題のみを対象とする
        // （※テスト範囲が空の場合はとりあえず「全範囲」として出題する、または「テスト範囲なし」扱いにする等の運用が可能です。今回はテスト範囲がある場合はフィルタリングします）
        if (testRangeUnitIds.length > 0) {
          const unitNo = quiz["単元番号"] || quiz["単元"];
          // "1-1"などの単元番号が、ラーニングサイトで設定したテスト対象の単元に含まれていなければ除外
          if (!unitNo || !testRangeUnitIds.includes(unitNo)) {
            continue;
          }
        }

        const progress = await getQuizProgress(user.uid, quiz["ID(自動生成)"]);
        if (progress) {
          tempProgressData[quiz["ID(自動生成)"]] = progress;
          
          if (progress.status === "mastered") {
            continue; // ◎を押した問題は出題しない
          }
          
          const nextDate = new Date(progress.nextReviewDate);
          if (nextDate <= now) {
            // 出題日時が過去・現在になっているもの（復習・×のやり直し含む）
            if (progress.status === "learning" || progress.isSameDayRetry) {
              reviewQuizzes.push(quiz); // 優先的に出題するため別配列に
            } else {
              targetQuizzes.push(quiz);
            }
          }
        } else {
          // まだ解いたことのない新規問題
          targetQuizzes.push(quiz);
        }
      }

      // 【要件】一度やって×だった問題を優先的に配置し、復習からスタートする
      const finalQuizzes = [...reviewQuizzes, ...targetQuizzes];
      
      setDailyQuizzes(finalQuizzes);
      setProgressData(tempProgressData);
      setIsReady(true);
    }

    if (!quizLoading && !testRangeLoading && user) {
      prepareDailyQuizzes();
    }
  }, [user, quizzes, quizLoading, testRangeLoading, testRangeUnitIds]);


  const handleShowAnswer = () => {
    answerShowTimeRef.current = Date.now();
    setShowAnswer(true);
    // iOS等での自動再生制限対策：ユーザーアクション時に無音再生を挟むなどの工夫が必要な場合はここで行う
  };

  useEffect(() => {
    if (showAnswer && cardRef.current) {
      window.scrollTo({
        top: cardRef.current.scrollHeight,
        behavior: "smooth",
      });
    }
  }, [showAnswer]);

  // ▼ 音声読み上げロジック ▼
  const isEnglishText = (text: string) => {
    if (!text) return false;
    // テキスト内の半角アルファベット・記号の割合が半分以上なら英語とみなす（漢字ひらがなが混ざると日本語扱い）
    const engCount = (text.match(/[a-zA-Z\s.,?!'"-]/g) || []).length;
    return engCount / text.length > 0.6;
  };

  const speakText = (text: string) => {
    if (!synthRef.current || !text) return;

    // 前の読み上げをキャンセル
    synthRef.current.cancel();

    const utterance = new SpeechSynthesisUtterance(text);
    
    // 英語と判定されたら英語の発音、そうでない場合は日本語
    if (isEnglishText(text)) {
      utterance.lang = "en-US";
      // ネイティブに近い女性・男性の声を探す（US or UK）
      const engVoice = voices.find(v => v.lang.includes('en-US')) || voices.find(v => v.lang.includes('en-GB'));
      if (engVoice) utterance.voice = engVoice;
      utterance.rate = 0.9; // ややゆっくりめに設定
    } else {
      utterance.lang = "ja-JP";
      const jaVoice = voices.find(v => v.lang === 'ja-JP');
      if (jaVoice) utterance.voice = jaVoice;
    }

    synthRef.current.speak(utterance);
  };

  // 問題が表示されたタイミングで、英語なら自動読み上げを実行
  useEffect(() => {
    if (isReady && dailyQuizzes.length > 0) {
      const currentQuiz = dailyQuizzes[currentIndex];
      if (currentQuiz && currentQuiz["問題文"]) {
        // "英語を見て日本語の意味を答える" 形式のため、問題文が英語判定なら自動再生
        if (isEnglishText(currentQuiz["問題文"])) {
          // 少しだけディレイを入れると体験が良い
          setTimeout(() => speakText(currentQuiz["問題文"]), 300);
        }
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentIndex, isReady, dailyQuizzes]);
  // ▲ 音声読み上げロジック 終了 ▲

  const handleEvaluation = async (evalType: EvaluationResult) => {
    if (!user || dailyQuizzes.length === 0) return;

    // --- インチキ防止（スピード違反チェック） ---
    const now = Date.now();
    const timeSpentOnQuestion = answerShowTimeRef.current - questionStartTimeRef.current;
    const timeSpentOnAnswer = now - answerShowTimeRef.current;

    // 「◎（超完璧）」や「〇（完璧）」の場合のみ厳しくチェック（思考が必要なはずのため）
    if (evalType === "master" || evalType === "circle") {
      // 1. 問題を見る時間が1秒未満
      // 2. 答えを見てから評価ボタンを押すまでが0.8秒未満
      // （※この数値は運用の様子を見て調整可能です）
      if (timeSpentOnQuestion < 1000 || timeSpentOnAnswer < 800) {
        alert("⚠️ 回答スピードが異常に早いです！\n問題文と解説をしっかり読み、自分で思考できているか確認してから『◎』や『〇』を押してください。");
        return; // 処理をキャンセルして画面に留める（ごまかせないようにする）
      }
    }
    // ------------------------------------------

    const currentQuiz = dailyQuizzes[currentIndex];
    const quizId = currentQuiz["ID(自動生成)"];
    const currentProg = progressData[quizId];

    // Firebaseに学習結果を保存し、次回出題日を計算
    const newProgress = await saveEvaluation(user.uid, quizId, evalType, currentProg);
    
    // UI側のプログレス状態も更新
    setProgressData(prev => ({
      ...prev,
      [quizId]: newProgress
    }));

    // 【要件】×(不正解)だった場合、当日のリストの後ろに追加する
    if (evalType === "cross") {
      setDailyQuizzes(prev => [...prev, currentQuiz]);
    }

    // 次の問題へ
    setShowAnswer(false);
    setCurrentIndex(prev => prev + 1);
    window.scrollTo({ top: 0, behavior: "instant" });
  };

  // 文字数によってテキストのクラス（サイズ）を動的に変える
  const getTextSizeClass = (text: string) => {
    if (!text) return "";
    if (text.length <= 10) return "text-xlarge"; // "apple", "run" など単語レベル
    if (text.length <= 30) return "text-large";  // 短めの例文
    return "";
  };

  if (authLoading || quizLoading || testRangeLoading || (!isReady && user)) {
    return (
      <div style={{ display: "flex", justifyContent: "center", alignItems: "center", height: "100vh" }}>
        <p>読み込み中...</p>
      </div>
    );
  }

  if (!user) {
    return <LoginScreen />;
  }

  if (error) {
    return (
      <div style={{ padding: 20, textAlign: "center", color: "red" }}>
        <p>エラーが発生しました: {error}</p>
      </div>
    );
  }

  if (quizzes.length === 0) {
    return (
      <div style={{ padding: 20, textAlign: "center" }}>
        <p>問題データが登録されていません。<br/>スプレッドシートに問題を追加し、公開フラグを「1」にしてください。</p>
      </div>
    );
  }

  // 今日の問題がすべて終わった場合
  if (currentIndex >= dailyQuizzes.length) {
    return (
      <div style={{ padding: 40, textAlign: "center", marginTop: "100px" }}>
        <h2 style={{color: "var(--primary)", fontSize: "2rem", marginBottom: "16px"}}>お疲れ様でした！🎉</h2>
        <p><strong>現在のテスト範囲（学習対象）</strong>の復習タスクはすべて完了しました！<br/>また明日、定着度を高めるために挑戦しましょう。</p>
      </div>
    );
  }

  // 現在の問題
  const currentQuiz = dailyQuizzes[currentIndex];

  return (
    <>
      <div style={{ padding: "10px 20px", background: "var(--card-bg)", display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: "10px" }}>
        <button 
          onClick={() => router.push('/')}
          style={{ background: "none", border: "none", color: "var(--primary)", fontSize: "1rem", cursor: "pointer", display: "flex", alignItems: "center", gap: 5, padding: 0 }}
        >
          <span>←</span> ダッシュボードに戻る
        </button>

        <div style={{ display: "flex", alignItems: "center", gap: "8px", fontSize: "0.9rem" }}>
          <label htmlFor="grade-select" style={{ color: "var(--text-color)" }}>テスト範囲:</label>
          <select 
            id="grade-select"
            value={overrideGrade}
            onChange={(e) => {
              setOverrideGrade(e.target.value);
              setIsReady(false); // 再計算させるためにローディング状態に戻す
              setCurrentIndex(0);
              setShowAnswer(false);
            }}
            style={{ 
              padding: "4px 8px", 
              borderRadius: "4px", 
              border: "1px solid #ccc",
              background: "white",
              color: "black",
              fontSize: "0.9rem"
            }}
          >
            <option value="">本来の学年</option>
            <option value="j1">中1</option>
            <option value="j2">中2</option>
            <option value="j3">中3</option>
            <option value="e1">小1</option>
            <option value="e2">小2</option>
            <option value="e3">小3</option>
            <option value="e4">小4</option>
            <option value="e5">小5</option>
            <option value="e6">小6</option>
          </select>
        </div>
      </div>
      <header className="header" style={{ paddingTop: 0 }}>
        <div className="header-content">
          <div className="breadcrumb" style={{ fontSize: "0.85rem" }}>
            {currentQuiz["学年"] ? `${currentQuiz["学年"]} ＞ ` : ""}
            {currentQuiz["科目"]} ＞ {currentQuiz["学年・分野"] || ""} ＞ {currentQuiz["単元番号"] || ""}
          </div>
          <div className="progress-info">
            <span className="progress-text">{currentIndex + 1} / {dailyQuizzes.length}問</span>
            <div className="progress-bar-bg">
              <div 
                className="progress-bar-fill" 
                style={{ width: `${Math.min(100, Math.round(((currentIndex) / dailyQuizzes.length) * 100))}%` }}
              ></div>
            </div>
          </div>
        </div>
      </header>
      
      <main className="main-container">
        <article className="card" ref={cardRef}>
          <div className="question-area" style={{ position: "relative" }}>
            <div className="question-label">Q.</div>
            
            {/* 品詞ラベルの表示 */}
            {currentQuiz["品詞"] && (
              <div style={{
                position: "absolute",
                top: 0,
                right: 0,
                backgroundColor: "var(--cross-color)", // 赤系の目立つ色
                color: "white",
                padding: "4px 12px",
                borderRadius: "20px",
                fontSize: "0.85rem",
                fontWeight: "bold",
                boxShadow: "0 2px 4px rgba(0,0,0,0.1)"
              }}>
                {currentQuiz["品詞"]}
              </div>
            )}

            <h2 
              className={`question-text ${getTextSizeClass(currentQuiz["問題文"])}`} 
              style={{ position: "relative", display: "inline-block", paddingRight: "40px", width: "100%" }}
            >
              {currentQuiz["問題文"]}
              
              {/* --- 音声再生ボタン --- */}
              {isEnglishText(currentQuiz["問題文"]) && (
                <button
                  onClick={() => speakText(currentQuiz["問題文"])}
                  style={{
                    position: "absolute",
                    right: 0,
                    top: "50%",
                    transform: "translateY(-50%)",
                    background: "none",
                    border: "none",
                    cursor: "pointer",
                    fontSize: "24px",
                    color: "var(--primary)",
                    padding: "4px",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    transition: "transform 0.1s"
                  }}
                  onMouseDown={(e) => e.currentTarget.style.transform = "translateY(-50%) scale(0.9)"}
                  onMouseUp={(e) => e.currentTarget.style.transform = "translateY(-50%) scale(1)"}
                  onMouseLeave={(e) => e.currentTarget.style.transform = "translateY(-50%) scale(1)"}
                  title="音声を再生"
                >
                  🔊
                </button>
              )}
            </h2>
            {currentQuiz["問題用画像URL"] && (
              <div className="image-container">
                <img src={currentQuiz["問題用画像URL"]} alt="問題画像" />
              </div>
            )}
          </div>
          
          {!showAnswer && (
            <button 
              className="btn btn-primary btn-large" 
              onClick={handleShowAnswer}
            >
              答えを見る
            </button>
          )}
          
          {showAnswer && (
            <div className="answer-section">
              <div className="answer-header">
                <span className="answer-label">A.</span>
              </div>
              
              <div className={`answer-text ${getTextSizeClass(currentQuiz["解答"])}`} style={{ position: "relative", display: "inline-block", alignSelf: "center", ...(isEnglishText(currentQuiz["解答"]) ? { paddingRight: "40px" } : {}) }}>
                {currentQuiz["解答"]}

                {/* --- 解答の音声再生ボタン（解答が英語メインの場合） --- */}
                {isEnglishText(currentQuiz["解答"]) && (
                  <button
                    onClick={() => speakText(currentQuiz["解答"])}
                    style={{
                      position: "absolute",
                      right: 0,
                      top: "50%",
                      transform: "translateY(-50%)",
                      background: "none",
                      border: "none",
                      cursor: "pointer",
                      fontSize: "24px",
                      color: "var(--cross-color)",
                      padding: "4px",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      transition: "transform 0.1s"
                    }}
                    onMouseDown={(e) => e.currentTarget.style.transform = "translateY(-50%) scale(0.9)"}
                    onMouseUp={(e) => e.currentTarget.style.transform = "translateY(-50%) scale(1)"}
                    onMouseLeave={(e) => e.currentTarget.style.transform = "translateY(-50%) scale(1)"}
                    title="音声を再生"
                  >
                    🔊
                  </button>
                )}
              </div>

              {currentQuiz["解答用画像URL"] && (
                <div className="image-container" style={{marginBottom: "20px"}}>
                  <img src={currentQuiz["解答用画像URL"]} alt="解答画像" />
                </div>
              )}
              
              {(currentQuiz["解説"] || currentQuiz["解説用画像URL"]) && (
                <div className="explanation-box">
                  <strong className="explanation-title">解説</strong>
                  {currentQuiz["解説"] && (
                    <p className="explanation-text">{currentQuiz["解説"]}</p>
                  )}
                  {currentQuiz["解説用画像URL"] && (
                    <div className="image-container" style={{marginTop: "12px"}}>
                      <img src={currentQuiz["解説用画像URL"]} alt="解説画像" />
                    </div>
                  )}
                </div>
              )}

              {currentQuiz["復習リンク(URL)"] && (
                <div className="learning-link-container">
                  <a 
                    href={currentQuiz["復習リンク(URL)"]} 
                    target="_blank"
                    rel="noopener noreferrer"
                    className="learning-link" 
                  >
                    <span className="icon">💡</span>
                    基礎から動画で復習する
                  </a>
                </div>
              )}
              
              <div className="evaluation-buttons">
                <button 
                  className="btn btn-eval btn-master" 
                  onClick={() => handleEvaluation("master")}
                >
                  <div className="eval-mark">◎</div>
                  <div className="eval-desc">超完璧<br />二度と出ない</div>
                </button>
                <button 
                  className="btn btn-eval btn-circle" 
                  onClick={() => handleEvaluation("circle")}
                >
                  <div className="eval-mark">〇</div>
                  <div className="eval-desc">正解した<br />完璧</div>
                </button>
                <button 
                  className="btn btn-eval btn-triangle" 
                  onClick={() => handleEvaluation("triangle")}
                >
                  <div className="eval-mark">△</div>
                  <div className="eval-desc">怪しい<br />正解</div>
                </button>
                <button 
                  className="btn btn-eval btn-cross" 
                  onClick={() => handleEvaluation("cross")}
                >
                  <div className="eval-mark">×</div>
                  <div className="eval-desc">不正解</div>
                </button>
              </div>
            </div>
          )}
        </article>
      </main>
    </>
  );
}

export default function QuizApp() {
  return (
    <Suspense fallback={
      <div style={{ display: "flex", justifyContent: "center", alignItems: "center", height: "100vh" }}>
        <p>準備中...</p>
      </div>
    }>
      <QuizAppContent />
    </Suspense>
  );
}
