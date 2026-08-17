"use client";

import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
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

function RoleBadge({ role }: { role: AccountRole }) {
  const { t } = useTranslation();
  const cls =
    role === "SUPER_ADMIN"
      ? "border border-red-500/40 bg-red-500/10 text-red-500"
      : role === "ADMIN"
        ? "border border-[#00E676]/40 bg-[#00E676]/10 text-[#00E676]"
        : "border border-border bg-muted text-muted-foreground";
  const roleLabel: Record<AccountRole, string> = {
    USER: t("accounts.roleUser"),
    ADMIN: t("accounts.roleAdmin"),
    SUPER_ADMIN: t("accounts.roleSuperAdmin"),
  };
  return <Badge className={cls}>{roleLabel[role]}</Badge>;
}

export default function AccountsPage() {
  const { t } = useTranslation();
  const fileStatusLabel = (status: string) =>
    status === "APPROVED"
      ? t("files.statusApproved")
      : status === "REJECTED"
        ? t("files.statusRejected")
        : status === "PENDING"
          ? t("files.statusPending")
          : status;
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
      toast.error(error instanceof Error ? error.message : t("accounts.loadFailed"));
    } finally {
      setLoading(false);
    }
  }, [page, limit, q, roleFilter, t]);

  useEffect(() => {
    load();
  }, [load]);

  const handleAdd = async () => {
    if (!form.name || !form.email || form.password.length < 8) {
      toast.error(t("accounts.formInvalid"));
      return;
    }
    setAdding(true);
    try {
      await createAccount(form);
      toast.success(t("accounts.createSuccess"));
      setShowAdd(false);
      setForm({ name: "", email: "", password: "", role: "ADMIN" });
      load();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t("accounts.createFailed"));
    } finally {
      setAdding(false);
    }
  };

  const handleRoleChange = async (id: string, role: AccountRole) => {
    if (!window.confirm(t("accounts.roleChangeConfirm"))) return;
    try {
      await changeAccountRole(id, role);
      toast.success(t("accounts.roleUpdateSuccess"));
      load();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t("accounts.roleUpdateFailed"));
    }
  };

  const openDetail = async (id: string) => {
    setDetailLoading(true);
    try {
      const data = await getAccount(id);
      setDetail(data);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t("accounts.detailLoadFailed"));
    } finally {
      setDetailLoading(false);
    }
  };

  const totalPages = Math.max(1, Math.ceil(total / limit));

  return (
    <div className="mx-auto max-w-6xl space-y-6 p-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-semibold">{t("accounts.title")}</h1>
        <div className="flex items-center gap-2">
          <Button onClick={() => setShowAdd(true)}>
            <Plus className="mr-1 h-4 w-4" /> {t("accounts.addAdmin")}
          </Button>
        </div>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">{t("accounts.total", { n: total })}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex flex-wrap gap-2">
            <div className="relative flex-1 min-w-52">
              <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
              <Input
                className="pl-8"
                placeholder={t("accounts.searchPlaceholder")}
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
                <SelectValue placeholder={t("accounts.role")} />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="">{t("accounts.roleAll")}</SelectItem>
                <SelectItem value="USER">{t("accounts.roleUser")}</SelectItem>
                <SelectItem value="ADMIN">{t("accounts.roleAdmin")}</SelectItem>
                <SelectItem value="SUPER_ADMIN">{t("accounts.roleSuperAdmin")}</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t("accounts.account")}</TableHead>
                <TableHead>{t("accounts.inviteCode")}</TableHead>
                <TableHead>{t("accounts.role")}</TableHead>
                <TableHead>{t("accounts.wallet")}</TableHead>
                <TableHead>{t("accounts.verification")}</TableHead>
                <TableHead>{t("accounts.content")}</TableHead>
                <TableHead>{t("accounts.registeredAt")}</TableHead>
                <TableHead>{t("accounts.actions")}</TableHead>
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
                  <TableCell className="font-mono text-xs">
                    {u.inviteCode?.code ?? "-"}
                  </TableCell>
                  <TableCell>
                    <RoleBadge role={u.role} />
                  </TableCell>
                  <TableCell className="max-w-40 truncate text-xs">
                    {u.wallet}
                  </TableCell>
                  <TableCell>
                    <div className="text-xs">
                      {u.emailVerified ? t("accounts.emailVerified") : t("accounts.emailUnverified")}
                      {u.emailOtpEnabled ? ` · ${t("accounts.forceOtp")}` : ""}
                      {u.totpEnabled ? " · TOTP" : ""}
                    </div>
                  </TableCell>
                  <TableCell className="text-xs">
                    {t("accounts.fileOrderCount", {
                      files: u._count?.files ?? 0,
                      orders: (u._count?.buyerDeals ?? 0) + (u._count?.sellerDeals ?? 0),
                    })}
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
                        <SelectItem value="USER">{t("accounts.roleUser")}</SelectItem>
                        <SelectItem value="ADMIN">{t("accounts.roleAdmin")}</SelectItem>
                        <SelectItem value="SUPER_ADMIN">{t("accounts.roleSuperAdmin")}</SelectItem>
                      </SelectContent>
                    </Select>
                  </TableCell>
                </TableRow>
              ))}
              {!loading && items.length === 0 && (
                <TableRow>
                  <TableCell colSpan={8} className="py-8 text-center text-muted-foreground">
                    {t("accounts.empty")}
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>

          <div className="flex items-center justify-between text-sm text-muted-foreground">
            <span>
              {t("accounts.page", { page, total: totalPages })}
            </span>
            <div className="flex gap-2">
              <Button
                variant="outline"
                size="sm"
                disabled={page <= 1}
                onClick={() => setPage((p) => p - 1)}
              >
                {t("accounts.previousPage")}
              </Button>
              <Button
                variant="outline"
                size="sm"
                disabled={page >= totalPages}
                onClick={() => setPage((p) => p + 1)}
              >
                {t("accounts.nextPage")}
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* 添加管理员 */}
      <Dialog open={showAdd} onOpenChange={setShowAdd}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("accounts.addAdminTitle")}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label>{t("accounts.name")}</Label>
              <Input
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                placeholder={t("accounts.namePlaceholder")}
              />
            </div>
            <div className="space-y-2">
              <Label>{t("accounts.email")}</Label>
              <Input
                type="email"
                value={form.email}
                onChange={(e) => setForm({ ...form, email: e.target.value })}
                placeholder="admin@example.com"
              />
            </div>
            <div className="space-y-2">
              <Label>{t("accounts.initialPassword")}</Label>
              <Input
                type="password"
                value={form.password}
                onChange={(e) => setForm({ ...form, password: e.target.value })}
                placeholder="******"
              />
            </div>
            <div className="space-y-2">
              <Label>{t("accounts.role")}</Label>
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
                  <SelectItem value="ADMIN">{t("accounts.roleAdmin")}</SelectItem>
                  <SelectItem value="SUPER_ADMIN">{t("accounts.roleSuperAdmin")}</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowAdd(false)}>
              {t("accounts.cancel")}
            </Button>
            <Button onClick={handleAdd} disabled={adding}>
              {adding ? t("accounts.creating") : t("accounts.createAccount")}
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
            <DialogTitle>{t("accounts.detailTitle")}</DialogTitle>
          </DialogHeader>
          {detailLoading && <p className="text-sm text-muted-foreground">{t("accounts.loading")}</p>}
          {detail && (
            <div className="space-y-4 text-sm">
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <div className="text-muted-foreground">{t("accounts.name")}</div>
                  <div className="font-medium">{detail.name}</div>
                </div>
                <div>
                  <div className="text-muted-foreground">{t("accounts.role")}</div>
                  <RoleBadge role={detail.role as AccountRole} />
                </div>
                <div>
                  <div className="text-muted-foreground">{t("accounts.email")}</div>
                  <div>{detail.email}</div>
                </div>
                <div>
                  <div className="text-muted-foreground">{t("accounts.walletLabel")}</div>
                  <div className="break-all">{detail.wallet}</div>
                </div>
                <div>
                  <div className="text-muted-foreground">{t("accounts.registeredAt")}</div>
                  <div>{new Date(detail.createdAt).toLocaleString("zh-CN")}</div>
                </div>
                <div>
                  <div className="text-muted-foreground">{t("accounts.verification")}</div>
                  <div>
                    {detail.emailVerified ? t("accounts.emailVerified") : t("accounts.emailUnverified")}
                    {detail.emailOtpEnabled ? ` · ${t("accounts.forceOtp")}` : ""}
                    {detail.totpEnabled ? " · TOTP" : ""}
                  </div>
                </div>
              </div>
              <div>
                <div className="mb-1 font-medium">{t("accounts.recentFiles", { n: detail.files?.length ?? 0 })}</div>
                {(detail.files ?? []).length === 0 ? (
                  <p className="text-muted-foreground">{t("accounts.none")}</p>
                ) : (
                  <ul className="space-y-1">
                    {(detail.files ?? []).map((f: AccountFile) => (
                      <li key={f.id} className="text-xs">
                        {f.filename} · {fileStatusLabel(f.status)}
                      </li>
                    ))}
                  </ul>
                )}
              </div>
              <div>
                <div className="mb-1 font-medium">
                  {t("accounts.recentDeals", {
                    n: (detail.buyerDeals ?? []).length + (detail.sellerDeals ?? []).length,
                  })}
                </div>
                {[...(detail.buyerDeals ?? []), ...(detail.sellerDeals ?? [])].length === 0 ? (
                  <p className="text-muted-foreground">{t("accounts.none")}</p>
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
