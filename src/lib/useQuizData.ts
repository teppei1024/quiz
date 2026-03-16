import { useState, useEffect } from 'react';

export interface QuizData {
  "ID(自動生成)": string;
  "科目": string;
  "学年"?: string;
  "学年・分野"?: string;
  "単元番号"?: string;
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
        const url = process.env.NEXT_PUBLIC_GAS_API_URL;
        if (!url) {
          throw new Error("GASのAPI URLが設定されていません。");
        }

        const res = await fetch(url, {
          redirect: "follow"
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
