# H-1 精准 SEARCH→REPLACE 补丁 hunk

每个 hunk 给出 **文件** 与 **OLD（原文，须与当前源码逐字一致）** / **NEW（替换后）**。
团队在编辑器中执行"查找→替换"即可（OLD 已包含足够上下文保证唯一匹配）。
（本次 Bash 工具不可用，未生成 `patch -p1` 统一补丁；如需我可在工具恢复后补生成。）

---

## Hunk 1 — precheck 由 WARN 改为硬失败 + 链上核实
文件：`scripts/precheck-mainnet-deploy.sh`

OLD:
```
# 审计 N-03：主网管理员应指向 Squads 多签（不阻塞，但必须显式声明）
if [[ -z "${MULTISIG_ADMIN}" ]]; then
  add_check "multisig admin" "WARN" "MULTISIG_ADMIN not set; pool/registry admin must point to a Squads multisig PDA before launch"
else
  add_check "multisig admin" "PASS" "${MULTISIG_ADMIN}"
fi
```

NEW:
```
# 审计 H-1（第六轮整改）：主网管理员必须指向 Squads 多签，且链上 multisig 字段已实际配置（硬失败，阻断上线）。
if [[ -z "${MULTISIG_ADMIN}" ]]; then
  add_check "multisig admin" "FAIL" "MULTISIG_ADMIN 必须设置（Squads 多签 PDA）；出厂单管理员不得上线"
else
  add_check "multisig admin" "PASS" "${MULTISIG_ADMIN}"
fi
# 链上核实：PoolState/Registry.multisig 必须非 None（依赖构建产物 contracts/target/idl，在 build/deploy 环境运行）。
if command -v node >/dev/null 2>&1 && [[ -f "${CONTRACTS_DIR}/target/idl/trade_finance.json" ]]; then
  if node "${ROOT}/scripts/check-onchain-multisig.mjs"; then
    add_check "on-chain multisig enforced" "PASS" "PoolState/Registry.multisig 均非 None"
  else
    add_check "on-chain multisig enforced" "FAIL" "链上 multisig 未配置（运行 scripts/configure-multisig.mjs 后重试；详见脚本输出）"
  fi
else
  add_check "on-chain multisig enforced" "FAIL" "缺少 node 或 contracts/target/idl（请在构建环境运行 precheck 以核实链上 multisig 已配置）"
fi
```

---

## Hunk 2 — trade-finance：vault 索引命名常量
文件：`contracts/programs/trade-finance/src/lib.rs`

OLD:
```
/// Squads v4 多签程序 ID（审计 H-1 链上强制，与 scripts/multisig-rehearsal 一致）。
pub const SQUADS_PROGRAM_ID: Pubkey = pubkey!("SQDS4ep65T869zMMBKyuUq6aD6EgTu8psMjkvj52pCf");
```

NEW:
```
/// Squads v4 多签程序 ID（审计 H-1 链上强制，与 scripts/multisig-rehearsal 一致）。
pub const SQUADS_PROGRAM_ID: Pubkey = pubkey!("SQDS4ep65T869zMMBKyuUq6aD6EgTu8psMjkvj52pCf");
/// Squads vault 索引（审计 H-1）：vault PDA 派生使用此索引。默认 0（Squads 多签单一金库）。
/// 若你的 Squads 多签对管理员交易使用非 0 vault 索引，须同步修改此处并重新构建。
pub const SQUADS_VAULT_INDEX: u8 = 0;
```

---

## Hunk 3 — trade-finance：check_authority 使用命名索引
文件：`contracts/programs/trade-finance/src/lib.rs`

OLD:
```
            let vault = derive_squads_vault(&ms, 0);
```

NEW:
```
            let vault = derive_squads_vault(&ms, SQUADS_VAULT_INDEX);
```

---

## Hunk 4 — supply-chain：vault 索引命名常量
文件：`contracts/programs/supply-chain/src/lib.rs`

OLD:
```
/// Squads v4 多签程序 ID（审计 H-1 链上强制，与 trade-finance 一致）。
pub const SQUADS_PROGRAM_ID: Pubkey = pubkey!("SQDS4ep65T869zMMBKyuUq6aD6EgTu8psMjkvj52pCf");
```

NEW:
```
/// Squads v4 多签程序 ID（审计 H-1 链上强制，与 trade-finance 一致）。
pub const SQUADS_PROGRAM_ID: Pubkey = pubkey!("SQDS4ep65T869zMMBKyuUq6aD6EgTu8psMjkvj52pCf");
/// Squads vault 索引（审计 H-1）。默认 0；若使用非 0 vault 索引须同步修改并重建。
pub const SQUADS_VAULT_INDEX: u8 = 0;
```

---

## Hunk 5 — supply-chain：check_authority 使用命名索引
文件：`contracts/programs/supply-chain/src/lib.rs`

OLD:
```
            let vault = derive_squads_vault(&ms, 0);
```

NEW:
```
            let vault = derive_squads_vault(&ms, SQUADS_VAULT_INDEX);
```

---

## Hunk 6 — deployment-info 诚实化（L21-23）
文件：`deployment-info.txt`

OLD:
```
  Chain上强制多签（H-1 根治）: PoolState/Registry.multisig 配置后，admin 签名者必须 ==
    Squads vault PDA（PDA["multisig", ms, "vault", 0]）；单签在链上被拒（MultisigEnforced）。
    回归 trade 7 + supply 4 用例全绿。
```

NEW:
```
  链上强制多签（H-1 机制，须部署期配置才生效）: PoolState/Registry.multisig 配置后，
    admin 签名者必须 == Squads vault PDA（PDA["multisig", ms, "vault", SQUADS_VAULT_INDEX]）；
    单签在链上被拒（MultisigEnforced）。注意：出厂 multisig = None（单管理员），
    须经 scripts/configure-multisig.mjs 配置 + precheck 链上核实后方可上线（否则判据 a 不满足）。
    负向回归 trade 7 + supply 4；正向正路径见 contracts/tests/h1-multisig-positive.test.ts（devnet 须通过）。
```

---

## Hunk 7 — deployment-info 诚实化（L44-52）
文件：`deployment-info.txt`

OLD:
```
更新（2026-08-09 第六轮 / H-1 链上强制多签）:
  - 链上强制多签实现（H-1 根治，判据 a）：PoolState/Registry 新增 multisig 字段 +
    propose_multisig/accept_multisig 两步时锁（下限 86400s）；check_authority 接入
    全部治理/资金指令（trade 21 / supply 6），配置后 admin 必须 == Squads vault PDA，
    单私钥直签在链上被拒。ABI 不变（admin: Signer），尾部追加字段。
  - indexer 同步：pool-state.parser.ts size 402→483 + multisig/pending_multisig 解析，
    layout-anchor.spec.ts 布局表 + roundtrip 单测。
  - 回归：anchor 82/82（含 H-1 trade 7 + supply 4）；后端 156/156。
  - 证据：docs/H-1-多签治理落地证据.md、docs/AUDIT-ROUND3-REMEDIATION-20260808.md。
```

NEW:
```
更新（2026-08-09 第六轮 / H-1 链上强制多签）:
  - 链上强制多签机制（H-1 链上部分就位，判据 a 仍需部署期强制配置 + 真实执行演练方可判定根治）：
    PoolState/Registry 新增 multisig 字段 + propose_multisig/accept_multisig 两步时锁（下限 86400s）；
    check_authority 接入全部治理/资金指令（trade 21 / supply 6），配置后 admin 必须 == Squads vault PDA，
    单私钥直签在链上被拒。ABI 不变（admin: Signer），尾部追加字段。
  - 部署期强制（第六轮整改）：出厂 multisig = None（单管理员）；上线前须运行
    scripts/configure-multisig.mjs 配置真实 Squads 多签，且 scripts/precheck-mainnet-deploy.sh
    的 on-chain multisig enforced 须 = PASS（硬失败门），否则阻断上线。
  - indexer 同步：pool-state.parser.ts size 402→483 + multisig/pending_multisig 解析，
    layout-anchor.spec.ts 布局表 + roundtrip 单测（SQUADS_VAULT_INDEX 默认 0，若用非 0 须同步）。
  - 回归：anchor 82/82（含 H-1 负向 trade 7 + supply 4）；真实 VaultTransaction 正路径测试见
    contracts/tests/h1-multisig-positive.test.ts（devnet 须通过，方证明机制可用而非仅拒绝）。
  - 证据：docs/H-1-多签治理落地证据.md、docs/AUDIT-ROUND3-REMEDIATION-20260808.md、本补丁包。
```
