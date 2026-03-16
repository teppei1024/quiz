import { useState, useEffect } from 'react';

export interface QuizData {
  "ID(自動生成)": string;
  "科目": string;
  "学年"?: string;
  "学年・分野"?: string;
  "単元番号"?: string;
  "単元"?: string;
  "問題文": string;
  "問題用画像URL"?: string;
  "解答": string;
  "解答用画像URL"?: string;
  "解説"?: string;
  "解説用画像URL"?: string;
  "復習リンク(URL)"?: string;
  "品詞"?: string;
  "公開フラグ": number | string;
}

export function useQuizData() {
  const [quizzes, setQuizzes] = useState<QuizData[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function fetchQuizzes() {
      try {
        const url = process.env.NEXT_PUBLIC_QUIZ_DATA_URL;
        if (!url) {
          throw new Error("クイズデータのURLが設定されていません。");
        }

        // GitHubからの取得ではキャッシュを都度無視するかどうかは要件によりますが、
        // 最新のデータを取得するためキャッシュを無効化しています（必要に応じて外してください）
        const res = await fetch(url + '?t=' + new Date().getTime(), {
          cache: 'no-store'
        });

        if (!res.ok) {
          throw new Error(`データの取得に失敗しました: ${res.status}`);
        }

        const data: QuizData[] = await res.json();
        setQuizzes(data);
        setError(null);
      } catch (err: any) {
        console.error("Fetch Error:", err);
        setError(err.message || "予期せぬエラーが発生しました");
      } finally {
        setLoading(false);
      }
    }

    fetchQuizzes();
  }, []);

  return { quizzes, loading, error };
}
