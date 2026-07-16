import { initializeApp } from "firebase/app";
import {
  getAnalytics,
  isSupported,
  logEvent,
  type Analytics,
} from "firebase/analytics";

const firebaseConfig = {
  apiKey: "AIzaSyDAtoHi3r9hPE0CTshpuw9z8tPuX2pqydE",
  authDomain: "project-e8d0eb79-8682-4bd9-b31.firebaseapp.com",
  projectId: "project-e8d0eb79-8682-4bd9-b31",
  storageBucket: "project-e8d0eb79-8682-4bd9-b31.firebasestorage.app",
  messagingSenderId: "388811826415",
  appId: "1:388811826415:web:3f8aa8e4caa3dbcd5fa71a",
  measurementId: "G-ZKGCC0C45Q",
};

const analyticsReady: Promise<Analytics | null> = import.meta.env.PROD
  ? isSupported()
      .then((supported) => {
        if (!supported) return null;
        return getAnalytics(initializeApp(firebaseConfig));
      })
      .catch(() => null)
  : Promise.resolve(null);

export function trackAnalyticsEvent(
  name: string,
  parameters?: Record<string, string | number | boolean>,
) {
  void analyticsReady.then((analytics) => {
    if (analytics) logEvent(analytics, name, parameters);
  });
}

