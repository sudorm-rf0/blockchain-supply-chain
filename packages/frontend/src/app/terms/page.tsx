"use client";

import Link from "next/link";
import { useTranslation } from "react-i18next";

export default function TermsPage() {
  const { t } = useTranslation();
  return (
    <main className="mx-auto flex w-full max-w-3xl flex-col gap-6 px-4 py-10">
      <h1 className="text-2xl font-bold">服务条款</h1>
      <p className="text-sm text-muted-foreground">
        更新日期：2026-08-16 · 运营主体：DFR 供应链平台
      </p>
      <div className="space-y-4 text-sm leading-7">
        <section>
          <h2 className="text-base font-semibold">一、服务内容</h2>
          <p>供应链金融单据存证、订单管理、链上（Solana）存证与结算辅助。</p>
        </section>
        <section>
          <h2 className="text-base font-semibold">二、实名与资质</h2>
          <p>企业用户须提供主体资质；个人用户按业务需要完成实名。</p>
        </section>
        <section>
          <h2 className="text-base font-semibold">三、区块链结算声明</h2>
          <p>涉及 USDC/加密货币结算时，须明示风险与监管状态；链上交易不可撤销，用户自行承担密钥保管责任。</p>
        </section>
        <section>
          <h2 className="text-base font-semibold">四、免责条款</h2>
          <p>因网络延迟、链拥堵、第三方 RPC/钱包故障、不可抗力等导致的服务中断或损失，平台依约免责。</p>
        </section>
        <section>
          <h2 className="text-base font-semibold">五、责任限制</h2>
          <p>平台对间接损失不承担责任；赔偿上限以约定为准。</p>
        </section>
        <section>
          <h2 className="text-base font-semibold">六、协议变更</h2>
          <p>服务条款变更将提前 30 日公告。</p>
        </section>
        <p className="rounded-md border border-amber-500/40 bg-amber-50 p-3 text-xs text-amber-700 dark:bg-amber-950/30 dark:text-amber-300">
          {t("legal.notice")}
        </p>
      </div>
      <p>
        <Link href="/privacy" className="text-primary underline">
          {t("legal.viewPrivacy")}
        </Link>
      </p>
    </main>
  );
}
