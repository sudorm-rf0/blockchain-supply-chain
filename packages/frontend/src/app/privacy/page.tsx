"use client";

import Link from "next/link";
import { useTranslation } from "react-i18next";

export default function PrivacyPage() {
  const { t } = useTranslation();
  return (
    <main className="mx-auto flex w-full max-w-3xl flex-col gap-6 px-4 py-10">
      <h1 className="text-2xl font-bold">隐私政策</h1>
      <p className="text-sm text-muted-foreground">
        更新日期：2026-08-16 · 运营主体：DFR 供应链平台 · 服务器所在地：中国香港
      </p>
      <div className="space-y-4 text-sm leading-7">
        <section>
          <h2 className="text-base font-semibold">一、收集的信息</h2>
          <p>我们收集以下信息以提供服务：注册信息（名称、邮箱、钱包地址）、单据文件（含图片/PDF 及识别文本）、登录与操作日志、设备与网络信息。</p>
        </section>
        <section>
          <h2 className="text-base font-semibold">二、使用目的</h2>
          <p>用于提供服务、安全风控、审计留痕与合规要求。AI 审核功能会基于单据内容调用第三方大模型服务，仅用于单据分析与答疑。</p>
        </section>
        <section>
          <h2 className="text-base font-semibold">三、存储与期限</h2>
          <p>服务器位于中国香港；单据按业务需要保留；审计日志默认保留 90 天；链上存证不可删除。</p>
        </section>
        <section>
          <h2 className="text-base font-semibold">四、用户权利</h2>
          <p>您有权查阅、复制、更正、删除您的个人信息（链上数据除外）、撤回同意并注销账号。可通过平台「意见反馈」联系我们。</p>
        </section>
        <section>
          <h2 className="text-base font-semibold">五、安全措施</h2>
          <p>全站 HTTPS 加密传输；TOTP 密钥 AES-256-GCM 加密存储；访问控制与操作审计。</p>
        </section>
        <section>
          <h2 className="text-base font-semibold">六、第三方共享</h2>
          <p>信息仅在提供服务的必要范围内共享给：云服务商、区块链 RPC 服务商、大模型服务商、审计机构；不向无关第三方出售数据。</p>
        </section>
        <section>
          <h2 className="text-base font-semibold">七、未成年人</h2>
          <p>本服务不面向未成年人。</p>
        </section>
        <p className="rounded-md border border-amber-500/40 bg-amber-50 p-3 text-xs text-amber-700 dark:bg-amber-950/30 dark:text-amber-300">
          {t("legal.notice")}
        </p>
      </div>
      <p>
        <Link href="/terms" className="text-primary underline">
          {t("legal.viewTerms")}
        </Link>
      </p>
    </main>
  );
}
