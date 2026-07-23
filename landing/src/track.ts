type AnalyticsModule = typeof import("./analytics");

let analyticsModulePromise: Promise<AnalyticsModule> | null = null;

function loadAnalytics() {
  if (!analyticsModulePromise) {
    analyticsModulePromise = import("./analytics");
  }
  return analyticsModulePromise;
}

export function preloadAnalytics() {
  void loadAnalytics();
}

export function trackAnalyticsEvent(
  name: string,
  parameters?: Record<string, string | number | boolean>,
) {
  void loadAnalytics().then((module) => {
    module.trackAnalyticsEvent(name, parameters);
  });
}
