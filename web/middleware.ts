import { NextRequest, NextResponse, userAgent } from "next/server";

const mobileRouteMap = new Map<string, string>([
  ["/", "/m"],
  ["/patients", "/m/patients"],
  ["/history", "/m/history"],
  ["/account", "/m/account"],
  ["/users", "/m/users"],
]);

const excludedPrefixes = [
  "/_next",
  "/api",
  "/m",
  "/attachment-view",
  "/follow-up",
  "/onboarding",
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
