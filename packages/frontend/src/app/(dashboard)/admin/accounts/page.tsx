"use client";

import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { Plus, Search } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  listAccounts,
  createAccount,
  changeAccountRole,
  getAccount,
  type AccountRecord,
  type AccountRole,
  type AccountDeal,
  type AccountFile,
} from "@/lib/api";

const ROLE_LABEL: Record<AccountRole, string> = {
  USER: "用户",
  ADMIN: "管理员",
  SUPER_ADMIN: "超级管理员",
};

function RoleBadge({ role }: { role: AccountRole }) {
  const cls =
    role === "SUPER_ADMIN"
      ? "border border-red-500/40 bg-red-500/10 text-red-500"
      : role === "ADMIN"
        ? "border border-[#00E676]/40 bg-[#00E676]/10 text-[#00E676]"
        : "border border-border bg-muted text-muted-foreground";
  return <Badge className={cls}>{ROLE_LABEL[role]}</Badge>;
}

export default function AccountsPage() {
  const [items, setItems] = useState<AccountRecord[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [limit] = useState(20);
  const [q, setQ] = useState("");
  const [roleFilter, setRoleFilter] = useState("");
  const [loading, setLoading] = useState(false);

  const [showAdd, setShowAdd] = useState(false);
  const [adding, setAdding] = useState(false);
  const [form, setForm] = useState({
    name: "",
    email: "",
    password: "",
    role: "ADMIN" as "ADMIN" | "SUPER_ADMIN",
  });

  const [detail, setDetail] = useState<Awaited<ReturnType<typeof getAccount>> | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await listAccounts({
        page,
        limit,
        q: q || undefined,
        role: roleFilter || undefined,
      });
      setItems(res.items);
      setTotal(res.total);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "加载账号列表失败");
    } finally {
      setLoading(false);
    }
  }, [page, limit, q, roleFilter]);

  useEffect(() => {
    load();
  }, [load]);

  const handleAdd = async () => {
    if (!form.name || !form.email || form.password.length < 8) {
      toast.error("请填写完整：姓名 / 邮箱 / 密码（至少 8 位）");
      return;
    }
    setAdding(true);
    try {
      await createAccount(form);
      toast.success("账号已创建");
      setShowAdd(false);
      setForm({ name: "", email: "", password: "", role: "ADMIN" });
      load();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "创建失败");
    } finally {
      setAdding(false);
    }
  };

  const handleRoleChange = async (id: string, role: AccountRole) => {
    try {
      await changeAccountRole(id, role);
      toast.success("账户类型已更新");
      load();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "更新失败");
    }
  };

  const openDetail = async (id: string) => {
    setDetailLoading(true);
    try {
      const data = await getAccount(id);
      setDetail(data);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "加载详情失败");
    } finally {
      setDetailLoading(false);
    }
  };

  const totalPages = Math.max(1, Math.ceil(total / limit));

  return (
    <div className="mx-auto max-w-6xl space-y-6 p-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">账号管理</h1>
        <Button onClick={() => setShowAdd(true)}>
          <Plus className="mr-1 h-4 w-4" /> 添加管理员
        </Button>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">全部账号（{total}）</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex flex-wrap gap-2">
            <div className="relative flex-1 min-w-52">
              <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
              <Input
                className="pl-8"
                placeholder="搜索邮箱 / 姓名"
                value={q}
                onChange={(e) => {
                  setQ(e.target.value);
                  setPage(1);
                }}
              />
            </div>
            <Select
              value={roleFilter}
              onValueChange={(v) => {
                setRoleFilter(v);
                setPage(1);
              }}
            >
              <SelectTrigger className="w-40">
                <SelectValue placeholder="账户类型" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="">全部</SelectItem>
                <SelectItem value="USER">用户</SelectItem>
                <SelectItem value="ADMIN">管理员</SelectItem>
                <SelectItem value="SUPER_ADMIN">超级管理员</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>账号</TableHead>
                <TableHead>账户类型</TableHead>
                <TableHead>钱包地址</TableHead>
                <TableHead>验证状态</TableHead>
                <TableHead>内容</TableHead>
                <TableHead>注册时间</TableHead>
                <TableHead>操作</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {items.map((u) => (
                <TableRow
                  key={u.id}
                  className="cursor-pointer"
                  onClick={() => openDetail(u.id)}
                >
                  <TableCell>
                    <div className="font-medium">{u.name}</div>
                    <div className="text-xs text-muted-foreground">{u.email}</div>
                  </TableCell>
                  <TableCell>
                    <RoleBadge role={u.role} />
                  </TableCell>
                  <TableCell className="max-w-40 truncate text-xs">
                    {u.wallet}
                  </TableCell>
                  <TableCell>
                    <div className="text-xs">
                      {u.emailVerified ? "邮箱已验证" : "邮箱未验证"}
                      {u.emailOtpEnabled ? " · 强制OTP" : ""}
                      {u.totpEnabled ? " · TOTP" : ""}
                    </div>
                  </TableCell>
                  <TableCell className="text-xs">
                    文件 {u._count?.files ?? 0} · 订单{" "}
                    {(u._count?.buyerDeals ?? 0) + (u._count?.sellerDeals ?? 0)}
                  </TableCell>
                  <TableCell className="text-xs">
                    {new Date(u.createdAt).toLocaleDateString("zh-CN")}
                  </TableCell>
                  <TableCell onClick={(e) => e.stopPropagation()}>
                    <Select
                      value={u.role}
                      onValueChange={(v) => handleRoleChange(u.id, v as AccountRole)}
                    >
                      <SelectTrigger className="h-8 w-36">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="USER">用户</SelectItem>
                        <SelectItem value="ADMIN">管理员</SelectItem>
                        <SelectItem value="SUPER_ADMIN">超级管理员</SelectItem>
                      </SelectContent>
                    </Select>
                  </TableCell>
                </TableRow>
              ))}
              {!loading && items.length === 0 && (
                <TableRow>
                  <TableCell colSpan={7} className="py-8 text-center text-muted-foreground">
                    没有找到账号
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>

          <div className="flex items-center justify-between text-sm text-muted-foreground">
            <span>
              第 {page} / {totalPages} 页
            </span>
            <div className="flex gap-2">
              <Button
                variant="outline"
                size="sm"
                disabled={page <= 1}
                onClick={() => setPage((p) => p - 1)}
              >
                上一页
              </Button>
              <Button
                variant="outline"
                size="sm"
                disabled={page >= totalPages}
                onClick={() => setPage((p) => p + 1)}
              >
                下一页
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* 添加管理员 */}
      <Dialog open={showAdd} onOpenChange={setShowAdd}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>添加管理员 / 超级管理员</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label>姓名</Label>
              <Input
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                placeholder="张三"
              />
            </div>
            <div className="space-y-2">
              <Label>邮箱</Label>
              <Input
                type="email"
                value={form.email}
                onChange={(e) => setForm({ ...form, email: e.target.value })}
                placeholder="admin@example.com"
              />
            </div>
            <div className="space-y-2">
              <Label>初始密码（至少 8 位）</Label>
              <Input
                type="password"
                value={form.password}
                onChange={(e) => setForm({ ...form, password: e.target.value })}
                placeholder="******"
              />
            </div>
            <div className="space-y-2">
              <Label>账户类型</Label>
              <Select
                value={form.role}
                onValueChange={(v) =>
                  setForm({ ...form, role: v as "ADMIN" | "SUPER_ADMIN" })
                }
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="ADMIN">管理员</SelectItem>
                  <SelectItem value="SUPER_ADMIN">超级管理员</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowAdd(false)}>
              取消
            </Button>
            <Button onClick={handleAdd} disabled={adding}>
              {adding ? "创建中..." : "创建账号"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* 账号详情（信息 + 内容） */}
      <Dialog
        open={!!detail}
        onOpenChange={(open) => {
          if (!open) setDetail(null);
        }}
      >
        <DialogContent className="max-h-[80vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>账号详情</DialogTitle>
          </DialogHeader>
          {detailLoading && <p className="text-sm text-muted-foreground">加载中...</p>}
          {detail && (
            <div className="space-y-4 text-sm">
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <div className="text-muted-foreground">姓名</div>
                  <div className="font-medium">{detail.name}</div>
                </div>
                <div>
                  <div className="text-muted-foreground">账户类型</div>
                  <RoleBadge role={detail.role as AccountRole} />
                </div>
                <div>
                  <div className="text-muted-foreground">邮箱</div>
                  <div>{detail.email}</div>
                </div>
                <div>
                  <div className="text-muted-foreground">钱包</div>
                  <div className="break-all">{detail.wallet}</div>
                </div>
                <div>
                  <div className="text-muted-foreground">注册时间</div>
                  <div>{new Date(detail.createdAt).toLocaleString("zh-CN")}</div>
                </div>
                <div>
                  <div className="text-muted-foreground">验证状态</div>
                  <div>
                    邮箱{detail.emailVerified ? "已验证" : "未验证"}
                    {detail.emailOtpEnabled ? " · 强制OTP" : ""}
                    {detail.totpEnabled ? " · TOTP" : ""}
                  </div>
                </div>
              </div>
              <div>
                <div className="mb-1 font-medium">最近文件（{detail.files?.length ?? 0}）</div>
                {(detail.files ?? []).length === 0 ? (
                  <p className="text-muted-foreground">无</p>
                ) : (
                  <ul className="space-y-1">
                    {(detail.files ?? []).map((f: AccountFile) => (
                      <li key={f.id} className="text-xs">
                        {f.filename} · {f.status}
                      </li>
                    ))}
                  </ul>
                )}
              </div>
              <div>
                <div className="mb-1 font-medium">
                  最近订单（{(detail.buyerDeals ?? []).length + (detail.sellerDeals ?? []).length}）
                </div>
                {[...(detail.buyerDeals ?? []), ...(detail.sellerDeals ?? [])].length === 0 ? (
                  <p className="text-muted-foreground">无</p>
                ) : (
                  <ul className="space-y-1">
                    {[...(detail.buyerDeals ?? []), ...(detail.sellerDeals ?? [])].map(
                      (d: AccountDeal) => (
                        <li key={d.id} className="text-xs">
                          {d.dealId} · {d.status} · {d.amount}
                        </li>
                      ),
                    )}
                  </ul>
                )}
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
