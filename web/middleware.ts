import { NextRequest, NextResponse, userAgent } from "next/server";

const SUPERDASHBOARD_SESSION_COOKIE_NAME = "superdashboard_session";

const mobileRouteMap = new Map<string, string>([
  ["/", "/m"],
  ["/appointments", "/m/appointments"],
  ["/patients", "/m/patients"],
  ["/billing", "/m/billing"],
  ["/inventory", "/m/inventory"],
  ["/history", "/m/history"],
  ["/generate-letter", "/m/generate-letter"],
  ["/earnings", "/m/earnings"],
  ["/case-study", "/m/case-study"],
  ["/users", "/m/users"],
  ["/clinic", "/m/clinic"],
  ["/account", "/m/account"],
  ["/audit", "/m/audit"],
  ["/training", "/m/training"],
  ["/about", "/m/about"],
]);

const excludedPrefixes = [
  "/_next",
  "/api",
  "/m",
  "/attachment-view",
  "/follow-up",
  "/onboarding",
  "/superdashboard",
  "/superuser",
];

function isMobileRequest(request: NextRequest) {
  const hintedMobile = request.headers.get("sec-ch-ua-mobile");
  if (hintedMobile === "?1") {
    return true;
  }

  const detectedType = userAgent(request).device.type;
  if (detectedType === "mobile" || detectedType === "tablet") {
    return true;
  }

  const agent = request.headers.get("user-agent") || "";
  return /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(agent);
}

export function middleware(request: NextRequest) {
  const { pathname, search } = request.nextUrl;

  const isSuperdashboardRoute =
    pathname === "/superdashboard" || pathname.startsWith("/superdashboard/");
  const isSuperdashboardLogin =
    pathname === "/superdashboard/login" || pathname.startsWith("/superdashboard/login/");
  if (
    isSuperdashboardRoute &&
    !isSuperdashboardLogin &&
    !request.cookies.get(SUPERDASHBOARD_SESSION_COOKIE_NAME)?.value
  ) {
    const loginUrl = request.nextUrl.clone();
    loginUrl.pathname = "/superdashboard/login";
    loginUrl.search = "";
    loginUrl.searchParams.set("next", `${pathname}${search}`);
    return NextResponse.redirect(loginUrl);
  }

  if (
    excludedPrefixes.some((prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`))
  ) {
    return NextResponse.next();
  }

  if (!isMobileRequest(request)) {
    return NextResponse.next();
  }

  const redirectPath = mobileRouteMap.get(pathname);
  if (!redirectPath) {
    return NextResponse.next();
  }

  const redirectUrl = request.nextUrl.clone();
  redirectUrl.pathname = redirectPath;
  redirectUrl.search = search;
  return NextResponse.redirect(redirectUrl);
}

export const config = {
  matcher: ["/((?!.*\\..*).*)"],
};
