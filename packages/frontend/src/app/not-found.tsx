import Link from "next/link";
import { Button } from "@/components/ui/button";

export default function NotFound() {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-4 p-6">
      <p className="text-xs font-semibold text-primary">DFR SUPPLY CHAIN</p>
      <h1 className="text-2xl font-bold text-foreground">页面不存在</h1>
      <p className="max-w-md text-center text-sm text-muted-foreground">
        你访问的页面不存在或已被移除，请检查地址是否正确。
      </p>
      <Button asChild>
        <Link href="/dashboard">返回首页</Link>
      </Button>
    </div>
  );
}
