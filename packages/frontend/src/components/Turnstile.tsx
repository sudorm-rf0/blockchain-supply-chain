"use client";

import { useEffect, useRef } from "react";
import { useTranslation } from "react-i18next";
import { TURNSTILE_SITE_KEY } from "@/lib/env";
import { SUPPORTED_LOCALES } from "@/lib/i18n";

declare global {
  interface Window {
    turnstile?: {
      render: (
        el: HTMLElement,
        opts: {
          sitekey: string;
          action?: string;
          callback?: (token: string) => void;
          "expired-callback"?: () => void;
          "error-callback"?: () => void;
          theme?: string;
          language?: string;
        },
      ) => string;
      remove: (widgetId?: string) => void;
    };
  }
}

interface TurnstileProps {
  onVerify: (token: string) => void;
  /** widget action（如 login / signup），后端 siteverify 会校验 */
  action?: string;
}

/**
 * Cloudflare Turnstile 人机验证组件。
 * 未配置 NEXT_PUBLIC_TURNSTILE_SITE_KEY 时不渲染（开发/过渡阶段）。
 */
export default function Turnstile({ onVerify, action }: TurnstileProps) {
  const { i18n } = useTranslation();
  const containerRef = useRef<HTMLDivElement>(null);
  const widgetIdRef = useRef<string | undefined>(undefined);
  const onVerifyRef = useRef(onVerify);
  onVerifyRef.current = onVerify;
  const actionRef = useRef(action);
  actionRef.current = action;
  // Turnstile 语言：跟随界面语言（zh-CN / en / zh-TW），未知语言回退 auto
  const language = (SUPPORTED_LOCALES as string[]).includes(i18n.language)
    ? i18n.language
    : "auto";

  useEffect(() => {
    if (!TURNSTILE_SITE_KEY) return;
    let cancelled = false;

    const render = () => {
      if (
        cancelled ||
        !containerRef.current ||
        !window.turnstile ||
        widgetIdRef.current
      ) {
        return;
      }
      widgetIdRef.current = window.turnstile.render(containerRef.current, {
        sitekey: TURNSTILE_SITE_KEY,
        action: actionRef.current,
        callback: (token: string) => onVerifyRef.current(token),
        "expired-callback": () => onVerifyRef.current(""),
        "error-callback": () => onVerifyRef.current(""),
        theme: "auto",
        language,
      });
    };

    if (window.turnstile) {
      render();
    } else {
      const script = document.createElement("script");
      script.src =
        "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";
      script.async = true;
      script.defer = true;
      script.onload = render;
      script.onerror = () => onVerifyRef.current("");
      document.head.appendChild(script);
    }

    return () => {
      cancelled = true;
      if (widgetIdRef.current && window.turnstile) {
        try {
          window.turnstile.remove(widgetIdRef.current);
        } catch {
          // 组件卸载时 widget 可能已被脚本移除，忽略
        }
      }
      widgetIdRef.current = undefined;
    };
  }, [language]);

  if (!TURNSTILE_SITE_KEY) return null;
  // 固定容器宽度（Cloudflare Turnstile iframe 标准宽度约 300px）：
  // 无论小组件是否渲染，表单宽度都保持稳定，不跳动。
  return <div ref={containerRef} className="cf-turnstile-widget mx-auto w-full min-w-[300px] max-w-[300px]" />;
}
