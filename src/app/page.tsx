"use client";

import { useEffect, useState, useMemo } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/lib/useAuth";
import { useQuizData } from "@/lib/useQuizData";
import { getAllProgress, getLeaderboard, QuizProgress } from "@/lib/useProgress";
import LoginScreen from "@/components/LoginScreen";

import {
  Chart as ChartJS,
  RadialLinearScale,
  PointElement,
  LineElement,
  Filler,
  Tooltip,
  Legend,
} from 'chart.js';
import { Radar } from 'react-chartjs-2';

ChartJS.register(
  RadialLinearScale,
  PointElement,
  LineElement,
  Filler,
  Tooltip,
  Legend
);

export default function Dashboard() {
  const { user, loading: authLoading } = useAuth();
  const router = useRouter();
  const { quizzes, loading: quizLoading } = useQuizData();
  
  const [progressData, setProgressData] = useState<QuizProgress[]>([]);
  const [leaderboard, setLeaderboard] = useState<any[]>([]);
  const [dataLoading, setDataLoading] = useState(true);
  
  // お試し学年の選択用のState
  const [selectedGrade, setSelectedGrade] = useState<string>("");

  useEffect(() => {
    async function loadDashboardData() {
      if (!user) return;
      setDataLoading(true);
      try {
        const [progress, board] = await Promise.all([
          getAllProgress(user.uid),
          getLeaderboard(10)
        ]);
        setProgressData(progress);
        setLeaderboard(board);
      } catch (err) {
        console.error("Dashboard data error:", err);
      } finally {
        setDataLoading(false);
      }
    }
    loadDashboardData();
  }, [user]);

  // レーダーチャート用のデータ計算（総問題数に対する「◎・〇」の割合）
  const chartData = useMemo(() => {
    if (!quizzes.length) return null;

    // 学年・分野ごとに 全問題数 と 学習済(◎/〇)数 をカウント
    const stats: Record<string, { total: number; learned: number }> = {};

    quizzes.forEach(q => {
      const subject = q["学年・分野"];
      if (!subject) return;
      if (!stats[subject]) stats[subject] = { total: 0, learned: 0 };
      stats[subject].total += 1;
    });

    (progressData || []).forEach(p => {
      if (!p) return;
      if (p.status === "mastered" || p.status === "review") {
        const q = quizzes.find(quiz => quiz && quiz["ID(自動生成)"] === p.quizId);
        if (q && q["学年・分野"] && stats[q["学年・分野"]]) {
          stats[q["学年・分野"]].learned += 1;
        }
      }
    });

    const labels = Object.keys(stats);
    
    // 定着率（パーセンテージ計算）
    const dataPoints = labels.map(label => {
      const { total, learned } = stats[label];
      return total > 0 ? Math.round((learned / total) * 100) : 0;
    });

    // レーダーチャートを綺麗に描画するため、軸が3つ未満の場合はダミーを追加
    let renderLabels = [...labels];
    let renderData = [...dataPoints];
    if (renderLabels.length === 1) {
      renderLabels = [labels[0], "　", "　　"];
      renderData = [dataPoints[0], 0, 0];
    } else if (renderLabels.length === 2) {
      renderLabels = [labels[0], labels[1], "　"];
      renderData = [dataPoints[0], dataPoints[1], 0];
    }

    return {
      labels: renderLabels.length > 0 ? renderLabels : ["データなし"],
      datasets: [
        {
          label: '定着度 (%)',
          data: renderData.length > 0 ? renderData : [0],
          backgroundColor: 'rgba(54, 162, 235, 0.4)',
          borderColor: 'rgba(54, 162, 235, 1)',
          borderWidth: 2,
          pointBackgroundColor: 'rgba(54, 162, 235, 1)',
        },
      ],
    };
  }, [quizzes, progressData]);

  const chartOptions = {
    scales: {
      r: {
        angleLines: { color: 'rgba(255, 255, 255, 0.1)' },
        grid: { color: 'rgba(255, 255, 255, 0.2)' },
        pointLabels: { color: '#ddd', font: { size: 14 } },
        ticks: { backdropColor: 'transparent', color: '#999', min: 0, max: 100, stepSize: 20 }
      }
    },
    plugins: {
      legend: { labels: { color: '#fff' } }
    }
  };

  if (authLoading || quizLoading || (user && dataLoading)) {
    return (
      <div style={{ display: "flex", justifyContent: "center", alignItems: "center", height: "100vh" }}>
        <p>データを読み込んでいます...</p>
      </div>
    );
  }

  if (!user) {
    return <LoginScreen />;
  }

  return (
    <div style={{ maxWidth: 600, margin: "0 auto", padding: "20px", paddingBottom: "100px", color: "var(--text-color, #333)" }}>
      <header style={{ marginBottom: 30, textAlign: "center" }}>
        <h1 style={{ fontSize: "2rem", color: "var(--primary, #3b82f6)" }}>ダッシュボード</h1>
        <p style={{ color: "var(--text-light, #aaa)", marginTop: 8 }}>ようこそ、{user.displayName}さん</p>
      </header>

      {/* レーダーチャートセクション */}
      <div style={{ background: "var(--card-bg, #fff)", padding: 20, borderRadius: 12, marginBottom: 30, boxShadow: "0 4px 6px rgba(0,0,0,0.1)" }}>
        <h2 style={{ fontSize: "1.2rem", marginBottom: 20, borderBottom: "1px solid var(--border-color, #eee)", paddingBottom: 10 }}>科目別 定着度</h2>
        <div style={{ maxWidth: 400, margin: "0 auto" }}>
          {chartData && chartData.labels[0] !== "データなし" ? (
            <Radar data={chartData} options={chartOptions as any} />
          ) : (
            <p style={{textAlign:"center", color:"#888", padding: "40px 0"}}>まだ問題データがありません</p>
          )}
        </div>
      </div>

      {/* ランキングセクション */}
      <div style={{ background: "var(--card-bg, #fff)", padding: 20, borderRadius: 12, marginBottom: 30, boxShadow: "0 4px 6px rgba(0,0,0,0.1)" }}>
        <h2 style={{ fontSize: "1.2rem", marginBottom: 20, borderBottom: "1px solid var(--border-color, #eee)", paddingBottom: 10, display: "flex", justifyContent: "space-between" }}>
          <span>塾内 ランキング</span>
          <span style={{ fontSize: "0.9rem", color: "var(--text-light, #888)", fontWeight: "normal" }}>TOP 10</span>
        </h2>
        
        <table style={{ width: "100%", borderCollapse: "collapse", textAlign: "left" }}>
          <thead>
            <tr style={{ borderBottom: "1px solid var(--border-color, #eee)", color: "var(--text-light, #888)", fontSize: "0.9rem" }}>
              <th style={{ padding: "8px 0" }}>順位</th>
              <th>名前</th>
              <th style={{ textAlign: "right" }}>スコア</th>
            </tr>
          </thead>
          <tbody>
            {leaderboard.map((u, i) => {
              if (!u || !u.uid) return null; // データが不正な場合はスキップしてクラッシュを防ぐ
              const rankColor = i === 0 ? "#FFD700" : i === 1 ? "#C0C0C0" : i === 2 ? "#cd7f32" : "#fff";
              
              return (
                <tr key={u.uid} style={{ borderBottom: "1px solid #333", background: u.uid === user.uid ? "rgba(54, 162, 235, 0.15)" : "transparent" }}>
                  <td style={{ padding: "12px 0", width: "50px", fontWeight: "bold", color: rankColor, fontSize: i < 3 ? "1.2rem" : "1rem"  }}>
                    {i + 1}
                  </td>
                  <td>
                    <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
                      {u.photoURL ? (
                        <img src={u.photoURL} alt="icon" style={{ width: 30, height: 30, borderRadius: "50%", objectFit: "cover" }} />
                      ) : (
                        <div style={{ width: 30, height: 30, borderRadius: "50%", background: "#555" }} />
                      )}
                      <span>
                        {u.displayName || "名無し"} 
                        {u.uid === user.uid && <span style={{ marginLeft: 6, fontSize: "0.8rem", color: "var(--primary)", background: "rgba(54, 162, 235, 0.2)", padding: "2px 6px", borderRadius: 10 }}>あなた</span>}
                      </span>
                    </div>
                  </td>
                  <td style={{ textAlign: "right", fontWeight: "bold", fontSize: "1.1rem", color: u.uid === user.uid ? "var(--primary)" : "#ddd" }}>
                    {(u.totalScore || 0).toLocaleString()}
                  </td>
                </tr>
              );
            })}
            {leaderboard.length === 0 && (
              <tr><td colSpan={3} style={{ textAlign: "center", padding: "30px", color: "#888" }}>まだスコアデータがありません</td></tr>
            )}
          </tbody>
        </table>
      </div>

      {/* 下部固定の学習開始ボタン */}
      <div style={{ textAlign: "center", position: "fixed", bottom: 0, left: 0, right: 0, padding: 16, background: "rgba(18,18,18,0.9)", backdropFilter: "blur(8px)", borderTop: "1px solid #333", zIndex: 10 }}>
        
        {/* お試し用の学年切り替えUI */}
        <div style={{ display: "flex", justifyContent: "center", alignItems: "center", gap: "10px", marginBottom: "12px", fontSize: "0.9rem" }}>
          <label htmlFor="grade-select" style={{ color: "#eee" }}>テスト範囲を選択して開始：</label>
          <select 
            id="grade-select"
            value={selectedGrade}
            onChange={(e) => setSelectedGrade(e.target.value)}
            style={{ 
              padding: "6px 10px", 
              borderRadius: "6px", 
              border: "1px solid #555",
              background: "#333",
              color: "white",
              fontSize: "0.9rem",
              cursor: "pointer"
            }}
          >
            <option value="">本来の学年（推奨）</option>
            <option value="j1">中1をお試し</option>
            <option value="j2">中2をお試し</option>
            <option value="j3">中3をお試し</option>
            <option value="e1">小1をお試し</option>
            <option value="e2">小2をお試し</option>
            <option value="e3">小3をお試し</option>
            <option value="e4">小4をお試し</option>
            <option value="e5">小5をお試し</option>
            <option value="e6">小6をお試し</option>
          </select>
        </div>

        <button 
          onClick={() => {
            if (selectedGrade) {
               router.push(`/quiz?grade=${selectedGrade}`);
            } else {
               router.push('/quiz');
            }
          }}
          style={{
            background: "linear-gradient(135deg, var(--primary) 0%, #2563eb 100%)",
            color: "white", padding: "18px 32px", borderRadius: "30px", fontSize: "1.3rem", fontWeight: "bold", border: "none", cursor: "pointer", width: "100%", maxWidth: 600, boxShadow: "0 4px 15px rgba(59, 130, 246, 0.5)", transition: "transform 0.2s"
          }}
          onMouseDown={(e) => e.currentTarget.style.transform = "scale(0.98)"}
          onMouseUp={(e) => e.currentTarget.style.transform = "scale(1)"}
          onMouseLeave={(e) => e.currentTarget.style.transform = "scale(1)"}
        >
          🚀 今日の学習を始める
        </button>
      </div>

    </div>
  );
}
