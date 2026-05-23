"use client";

import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import type { CreateEnterprisePayload, Enterprise } from "@/features/enterprises/types";

type EnterpriseContextValue = {
  enterprises: Enterprise[];
  activeEnterpriseId: string | null;
  activeEnterprise: Enterprise | null;
  isLoading: boolean;
  createEnterprise: (payload: CreateEnterprisePayload) => Promise<void>;
  selectEnterprise: (enterpriseId: string) => void;
  refreshEnterprises: () => Promise<void>;
};

const EnterpriseContext = createContext<EnterpriseContextValue | null>(null);

const STORAGE_KEY = "active-enterprise-id";

export function EnterpriseProvider({
  children,
  initialEnterprises,
}: {
  children: ReactNode;
  initialEnterprises: Enterprise[];
}) {
  const [enterprises, setEnterprises] = useState(initialEnterprises);
  const [activeEnterpriseId, setActiveEnterpriseId] = useState<string | null>(
    initialEnterprises[0]?.id ?? null,
  );
  const [isLoading, setIsLoading] = useState(false);

  useEffect(() => {
    setEnterprises(initialEnterprises);
    setActiveEnterpriseId((current) => current ?? initialEnterprises[0]?.id ?? null);
  }, [initialEnterprises]);

  async function refreshEnterprises() {
    setIsLoading(true);

    try {
      const response = await fetch("/api/enterprises", { cache: "no-store" });

      if (!response.ok) {
        throw new Error("Не удалось получить список предприятий.");
      }

      const data = (await response.json()) as Enterprise[];
      setEnterprises(data);
    } finally {
      setIsLoading(false);
    }
  }

  useEffect(() => {
    void refreshEnterprises();
  }, []);

  useEffect(() => {
    const storedEnterpriseId = window.localStorage.getItem(STORAGE_KEY);
    const hasStoredEnterprise = storedEnterpriseId
      ? enterprises.some((enterprise) => enterprise.id === storedEnterpriseId)
      : false;

    if (hasStoredEnterprise && storedEnterpriseId) {
      setActiveEnterpriseId(storedEnterpriseId);
      return;
    }

    if (enterprises.length > 0) {
      setActiveEnterpriseId(enterprises[0].id);
      window.localStorage.setItem(STORAGE_KEY, enterprises[0].id);
      return;
    }

    setActiveEnterpriseId(null);
    window.localStorage.removeItem(STORAGE_KEY);
  }, [enterprises]);

  async function createEnterprise(payload: CreateEnterprisePayload) {
    setIsLoading(true);

    try {
      const response = await fetch("/api/enterprises", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(payload),
      });

      if (!response.ok) {
        throw new Error("Не удалось создать предприятие.");
      }

      const createdEnterprise = (await response.json()) as Enterprise;

      setEnterprises((current) => [createdEnterprise, ...current]);
      setActiveEnterpriseId(createdEnterprise.id);
      window.localStorage.setItem(STORAGE_KEY, createdEnterprise.id);
    } finally {
      setIsLoading(false);
    }
  }

  function selectEnterprise(enterpriseId: string) {
    setActiveEnterpriseId(enterpriseId);
    window.localStorage.setItem(STORAGE_KEY, enterpriseId);
  }

  const activeEnterprise =
    enterprises.find((enterprise) => enterprise.id === activeEnterpriseId) ?? null;

  const value = useMemo(
    () => ({
      enterprises,
      activeEnterpriseId,
      activeEnterprise,
      isLoading,
      createEnterprise,
      selectEnterprise,
      refreshEnterprises,
    }),
    [enterprises, activeEnterpriseId, activeEnterprise, isLoading],
  );

  return <EnterpriseContext.Provider value={value}>{children}</EnterpriseContext.Provider>;
}

export function useEnterprise() {
  const context = useContext(EnterpriseContext);

  if (!context) {
    throw new Error("useEnterprise must be used within EnterpriseProvider.");
  }

  return context;
}
