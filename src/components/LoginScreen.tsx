"use client";

import { signInWithPopup, GoogleAuthProvider, signOut } from "firebase/auth";
import { auth } from "@/lib/firebase";

export default function LoginScreen() {
  const handleGoogleLogin = async () => {
    try {
      const provider = new GoogleAuthProvider();
      await signInWithPopup(auth, provider);
    } catch (error) {
      console.error("ログインエラー:", error);
      alert("ログインに失敗しました。もう一度お試しください。");
    }
  };

  return (
    <div className="login-container">
      <div className="login-card">
        <h1 className="login-title">一問一答アプリ</h1>
        <p className="login-desc">ラーニングサイトのアカウントでログインしてください。</p>
        <button className="btn btn-google" onClick={handleGoogleLogin}>
          <span className="google-icon">G</span>
          Googleでログイン
        </button>
      </div>
    </div>
  );
}
