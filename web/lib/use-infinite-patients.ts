"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { api } from "@/lib/api";
import type { Patient, PatientStatus } from "@/lib/types";

type InfinitePatientOptions = {
  enabled?: boolean;
  q?: string;
  status?: PatientStatus;
  billed?: boolean;
  pageSize?: number;
  debounceMs?: number;
};

export function useInfinitePatients({
  enabled = true,
  q = "",
  status,
  billed,
  pageSize = 20,
  debounceMs = 300,
}: InfinitePatientOptions = {}) {
  const [patients, setPatients] = useState<Patient[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [hasMore, setHasMore] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [error, setError] = useState("");
  const [reloadKey, setReloadKey] = useState(0);
  const sentinelRef = useRef<HTMLDivElement | null>(null);
  const generationRef = useRef(0);
  const loadMoreInFlightRef = useRef(false);
  const normalizedQuery = q.trim();
  const queryKey = useMemo(
    () => JSON.stringify([normalizedQuery, status ?? "", billed ?? "", pageSize, reloadKey]),
    [billed, normalizedQuery, pageSize, reloadKey, status],
  );

  const reload = useCallback(() => setReloadKey((value) => value + 1), []);

  useEffect(() => {
    const generation = ++generationRef.current;
    loadMoreInFlightRef.current = false;
    if (!enabled) {
      setPatients([]);
      setNextCursor(null);
      setHasMore(false);
      setIsLoading(false);
      setIsLoadingMore(false);
      return;
    }
    setIsLoading(true);
    setError("");
    const timeoutId = window.setTimeout(() => {
      void api.listPatients({
        q: normalizedQuery || undefined,
        status,
        billed,
        limit: pageSize,
      }).then((page) => {
        if (generation !== generationRef.current) return;
        setPatients(page.items);
        setNextCursor(page.next_cursor);
        setHasMore(page.has_more);
      }).catch((loadError) => {
        if (generation !== generationRef.current) return;
        setError(loadError instanceof Error ? loadError.message : "Failed to load patients.");
      }).finally(() => {
        if (generation === generationRef.current) setIsLoading(false);
      });
    }, normalizedQuery ? debounceMs : 0);
    return () => window.clearTimeout(timeoutId);
  }, [billed, debounceMs, enabled, normalizedQuery, pageSize, queryKey, status]);

  const loadMore = useCallback(async () => {
    if (!enabled || !hasMore || !nextCursor || loadMoreInFlightRef.current) return;
    loadMoreInFlightRef.current = true;
    const generation = generationRef.current;
    setIsLoadingMore(true);
    setError("");
    try {
      const page = await api.listPatients({
        q: normalizedQuery || undefined,
        status,
        billed,
        limit: pageSize,
        cursor: nextCursor,
      });
      if (generation !== generationRef.current) return;
      setPatients((current) => {
        const known = new Set(current.map((patient) => patient.id));
        return [...current, ...page.items.filter((patient) => !known.has(patient.id))];
      });
      setNextCursor(page.next_cursor);
      setHasMore(page.has_more);
    } catch (loadError) {
      if (generation === generationRef.current) {
        setError(loadError instanceof Error ? loadError.message : "Failed to load more patients.");
      }
    } finally {
      if (generation === generationRef.current) setIsLoadingMore(false);
      loadMoreInFlightRef.current = false;
    }
  }, [billed, enabled, hasMore, nextCursor, normalizedQuery, pageSize, status]);

  useEffect(() => {
    const target = sentinelRef.current;
    if (!target || !hasMore || !enabled) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) void loadMore();
      },
      { rootMargin: "240px" },
    );
    observer.observe(target);
    return () => observer.disconnect();
  }, [enabled, hasMore, loadMore]);

  return {
    patients,
    setPatients,
    hasMore,
    isLoading,
    isLoadingMore,
    error,
    reload,
    loadMore,
    sentinelRef,
  };
}
