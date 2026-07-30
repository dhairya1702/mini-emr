import "server-only";

import { cookies } from "next/headers";

const SUPERDASHBOARD_SESSION_COOKIE_NAME = "superdashboard_session";

function backendBaseUrl() {
  const configured =
    process.env.BACKEND_PROXY_URL ||
    process.env.NEXT_PUBLIC_API_BASE_URL ||
    "http://127.0.0.1:8001";
  return configured.replace(/\/$/, "");
}

export async function hasValidSuperdashboardSession() {
  const cookieStore = await cookies();
  const token = cookieStore.get(SUPERDASHBOARD_SESSION_COOKIE_NAME)?.value;
  if (!token) {
    return false;
  }

  const baseUrl = backendBaseUrl();
  if (!/^https?:\/\//i.test(baseUrl)) {
    return false;
  }

  try {
    const response = await fetch(`${baseUrl}/superdashboard/auth/session`, {
      headers: {
        cookie: `${SUPERDASHBOARD_SESSION_COOKIE_NAME}=${token}`,
      },
      cache: "no-store",
    });
    return response.ok;
  } catch {
    return false;
  }
}
