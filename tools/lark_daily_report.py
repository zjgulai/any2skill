#!/usr/bin/env python3
"""Know 项目日报 → 飞书 docx + 仓内 md 双落点工具。

用法
  python3 tools/lark_daily_report.py --selftest          # 自检：凭据/读/写/幂等/md 检查器
  python3 tools/lark_daily_report.py --file day.json     # dry-run，只打印预览
  python3 tools/lark_daily_report.py --file day.json --apply
  python3 tools/lark_daily_report.py --md reports/Know-日报-YYYYMMDD.md --check
  python3 tools/lark_daily_report.py --md reports/Know-日报-YYYYMMDD.md --fix

设计要点
  - 凭据只从仓外 0600 文件读（默认 ~/.know/lark-daily.creds.json），不打印、不入仓。
  - 默认 dry-run；--apply 才对外写入。
  - 同日幂等：先删该日期整节，再按日期倒序插回，重复跑不产生重复条目。
  - 写后回读核对：日期标题 + 三个板块标题 + 各自条目数。
"""

from __future__ import annotations

import argparse
import json
import os
import re
import stat
import sys
import urllib.error
import urllib.request
from datetime import date

BASE = "https://open.feishu.cn/open-apis"
DEFAULT_CREDS = os.path.expanduser("~/.know/lark-daily.creds.json")

WEEKDAYS = ["周一", "周二", "周三", "周四", "周五", "周六", "周日"]
SECTIONS = [("progress", "今日进展"), ("verify", "验证结果"), ("todo", "没做完的")]

# docx block types
# 注意：飞书 docx 的块字段名没有下划线（heading2/heading3），
# 写成 heading_2 会返回 1770001 invalid param。
BT_TEXT = 2
BT_H2 = 4
BT_H3 = 5
BT_ORDERED = 13
BT_NAME = {BT_TEXT: "text", BT_H2: "heading2", BT_H3: "heading3", BT_ORDERED: "ordered"}

DATE_RE = re.compile(r"^(\d{4}-\d{2}-\d{2})")

EXIT_OK = 0
EXIT_FAIL = 1
EXIT_UNMET = 2


# ---------------------------------------------------------------- credentials

def load_creds(path: str) -> dict:
    if not os.path.exists(path):
        raise SystemExit(f"凭据文件不存在：{path}（应放在仓外，权限 0600）")
    mode = stat.S_IMODE(os.stat(path).st_mode)
    if mode & 0o077:
        raise SystemExit(f"凭据文件权限过宽：{oct(mode)}，请 chmod 600 {path}")
    with open(path, "r", encoding="utf-8") as fh:
        c = json.load(fh)
    for k in ("app_id", "app_secret", "doc_token"):
        if not c.get(k):
            raise SystemExit(f"凭据文件缺字段：{k}")
    return c


# ---------------------------------------------------------------- API client

class Feishu:
    def __init__(self, creds: dict):
        self.app_id = creds["app_id"]
        self.app_secret = creds["app_secret"]
        self.doc = creds["doc_token"]
        self._token = None

    def token(self) -> str:
        if self._token:
            return self._token
        body = json.dumps(
            {"app_id": self.app_id, "app_secret": self.app_secret}
        ).encode()
        req = urllib.request.Request(
            f"{BASE}/auth/v3/tenant_access_token/internal",
            data=body,
            headers={"Content-Type": "application/json"},
        )
        r = json.load(urllib.request.urlopen(req, timeout=15))
        if r.get("code") != 0:
            raise SystemExit(f"取 tenant_access_token 失败：{r.get('code')} {r.get('msg')}")
        self._token = r["tenant_access_token"]
        return self._token

    def call(self, method: str, path: str, body=None) -> dict:
        data = json.dumps(body).encode() if body is not None else None
        req = urllib.request.Request(
            f"{BASE}{path}",
            data=data,
            headers={
                "Authorization": f"Bearer {self.token()}",
                "Content-Type": "application/json",
            },
            method=method,
        )
        try:
            return json.load(urllib.request.urlopen(req, timeout=25))
        except urllib.error.HTTPError as e:
            raw = e.read().decode("utf-8", "replace")
            try:
                return json.loads(raw)
            except json.JSONDecodeError:
                return {"code": e.code, "msg": raw[:400]}

    # -- block helpers -----------------------------------------------------

    def root_block(self) -> str:
        blocks = self.list_blocks()
        return blocks[0]["block_id"]

    def list_blocks(self) -> list:
        r = self.call("GET", f"/docx/v1/documents/{self.doc}/blocks?page_size=500")
        if r.get("code") != 0:
            raise SystemExit(f"读块失败：{r.get('code')} {r.get('msg')}")
        return r["data"].get("items", [])

    def children(self, block_id: str) -> list:
        r = self.call(
            "GET",
            f"/docx/v1/documents/{self.doc}/blocks/{block_id}/children?page_size=500",
        )
        if r.get("code") != 0:
            raise SystemExit(f"读子块失败：{r.get('code')} {r.get('msg')}")
        return r["data"].get("items", [])

    def raw(self) -> str:
        r = self.call("GET", f"/docx/v1/documents/{self.doc}/raw_content")
        if r.get("code") != 0:
            raise SystemExit(f"读正文失败：{r.get('code')} {r.get('msg')}")
        return r["data"].get("content", "")

    def insert(self, parent: str, blocks: list, index: int = 0) -> dict:
        return self.call(
            "POST",
            f"/docx/v1/documents/{self.doc}/blocks/{parent}/children"
            f"?document_revision_id=-1",
            {"children": blocks, "index": index},
        )

    def delete_range(self, parent: str, start: int, end: int) -> dict:
        return self.call(
            "DELETE",
            f"/docx/v1/documents/{self.doc}/blocks/{parent}/children/batch_delete"
            f"?document_revision_id=-1",
            {"start_index": start, "end_index": end},
        )


def block_text(b: dict) -> str:
    node = b.get(BT_NAME.get(b.get("block_type"), "")) or {}
    return "".join(
        e.get("text_run", {}).get("content", "") for e in node.get("elements", [])
    )


def h2(content: str) -> dict:
    return {"block_type": BT_H2, "heading2": {"elements": [{"text_run": {"content": content}}], "style": {}}}


def h3(content: str) -> dict:
    return {"block_type": BT_H3, "heading3": {"elements": [{"text_run": {"content": content}}], "style": {}}}


def txt(content: str) -> dict:
    return {"block_type": BT_TEXT, "text": {"elements": [{"text_run": {"content": content}}], "style": {}}}


# ---------------------------------------------------------------- day payload

def normalize_day(payload: dict) -> dict:
    """接受中英文字段名，统一成 {date, weekday, progress[], verify[], todo[]}。"""
    alias = {
        "date": ["date", "日期"],
        "weekday": ["weekday", "周", "星期"],
        "progress": ["progress", "今日进展"],
        "verify": ["verify", "验证结果"],
        "todo": ["todo", "没做完的", "未完成"],
    }
    out: dict = {}
    for canon, keys in alias.items():
        for k in keys:
            if k in payload:
                out[canon] = payload[k]
                break

    if not out.get("date"):
        raise SystemExit("payload 缺 date/日期")
    d = str(out["date"]).strip()
    if not re.fullmatch(r"\d{4}-\d{2}-\d{2}", d):
        raise SystemExit(f"date 格式应为 YYYY-MM-DD：{d}")
    out["date"] = d
    if not out.get("weekday"):
        out["weekday"] = WEEKDAYS[date.fromisoformat(d).weekday()]

    for s in ("progress", "verify", "todo"):
        v = out.get(s) or []
        if isinstance(v, str):
            v = [line for line in v.split("\n") if line.strip()]
        out[s] = [str(x).strip() for x in v if str(x).strip()]
    return out


def build_section(day: dict) -> list:
    """段落块承载手写编号（1. / 1.1）。

    不用有序列表块：飞书会给 ol 自动加 seq-marker，条目正文里已带
    「1. 「1.1」前缀时会渲染成双重编号。参照文档也是段落。
    """
    blocks = [h2(f"{day['date']}（{day['weekday']}）")]
    for key, title in SECTIONS:
        blocks.append(h3(title))
        items = day[key]
        if not items:
            blocks.append(txt("（本日无条目）"))
        for it in items:
            blocks.append(txt(it))
    return blocks


def find_section(blocks: list, date_str: str):
    """返回 (start, end)：目标日期整节的子块索引区间，找不到返回 (None, None)。"""
    start = None
    for i, b in enumerate(blocks):
        if b.get("block_type") != BT_H2:
            continue
        m = DATE_RE.match(block_text(b).strip())
        if not m:
            continue
        if start is not None:
            return start, i
        if m.group(1) == date_str:
            start = i
    return (start, len(blocks)) if start is not None else (None, None)


def insertion_index(blocks: list, date_str: str) -> int:
    """日期倒序：插到第一个更晚日期之前；没有更晚的就追加到末尾。"""
    for i, b in enumerate(blocks):
        if b.get("block_type") != BT_H2:
            continue
        m = DATE_RE.match(block_text(b).strip())
        if m and m.group(1) > date_str:
            return i
    return len(blocks)


# ---------------------------------------------------------------- md checker

# 只把 NUL 当作字节级填充。U+FFFD 单独按字符计数——
# 若把 U+FFFD 的 UTF-8 字节（EF BF BD）放进字节集合，
# 中文正文里的续字节会撞上 0xBF / 0xBD，造成误报。
PAD_BYTE = 0x00
RUN_LIMIT = 512


def check_md(path: str):
    """返回 (问题列表, 统计)。问题空 = 绿。"""
    problems = []
    if not os.path.exists(path):
        return [f"文件不存在：{path}"], {}

    raw = open(path, "rb").read()
    stats = {"bytes": len(raw)}

    try:
        raw.decode("utf-8")
    except UnicodeDecodeError as e:
        problems.append(f"非法 UTF-8：{e}")

    text = raw.decode("utf-8", "replace")
    stats["replacement_chars"] = text.count("�")
    if stats["replacement_chars"]:
        problems.append(f"含 U+FFFD 替换字符 {stats['replacement_chars']} 个")

    stats["nul_bytes"] = raw.count(b"\x00")
    if stats["nul_bytes"]:
        problems.append(f"含 NUL 字节 {stats['nul_bytes']} 个")

    # 长串同字节填充（+4096 填充类问题）
    longest, cur, run_byte = 0, 0, None
    for byte in raw:
        if byte == run_byte and byte == PAD_BYTE:
            cur += 1
        else:
            run_byte, cur = byte, 1
        longest = max(longest, cur)
    stats["longest_pad_run"] = longest
    if longest >= RUN_LIMIT:
        problems.append(f"存在长串填充 {longest} 字节（≥{RUN_LIMIT} 视为损坏）")

    # 行尾块状填充（4096 的整数倍）
    tail = len(raw) - len(raw.rstrip(b"\x00"))
    stats["tail_pad"] = tail
    if tail >= RUN_LIMIT:
        problems.append(f"文件尾部填充 {tail} 字节")

    return problems, stats


def fix_md(path: str):
    raw = open(path, "rb").read()
    before = len(raw)
    # 去掉尾部 NUL 填充
    raw = raw.rstrip(b"\x00")
    # 去掉内部超长 NUL 填充串
    if PAD_BYTE in raw:
        cleaned = bytearray()
        run, cur = 0, None
        for byte in raw:
            if byte == cur and byte == PAD_BYTE:
                run += 1
            else:
                cur, run = byte, 1
            if not (byte == PAD_BYTE and run >= RUN_LIMIT):
                cleaned.append(byte)
        raw = bytes(cleaned)
    text = raw.decode("utf-8", "replace").replace("�", "")
    open(path, "wb").write(text.encode("utf-8"))
    return before - len(text.encode("utf-8"))


# ---------------------------------------------------------------- commands

def cmd_selftest(fs: Feishu, creds_path: str) -> int:
    results = []

    def check(name, fn):
        try:
            ok, detail = fn()
        except SystemExit as e:
            ok, detail = False, str(e)
        except Exception as e:  # noqa: BLE001
            ok, detail = False, f"{type(e).__name__}: {e}"
        results.append((name, ok, detail))
        print(f"[{'PASS' if ok else 'FAIL'}] {name} — {detail}")
        return ok

    check("凭据文件在仓外且 0600", lambda: (
        not os.path.abspath(creds_path).startswith(os.getcwd() + os.sep),
        creds_path))

    def _token():
        t = fs.token()
        return bool(t), "已获取" if t else "空 token"

    check("tenant_access_token", _token)

    def _title():
        blocks = fs.list_blocks()
        root = blocks[0]
        title = block_text(root).strip() or (root.get("page") or {}).get("elements", [{}])[0].get("text_run", {}).get("content", "")
        return bool(title), f"文档标题：{title or '(空)'}"

    check("文档可读 + 标题存在", _title)

    def _readable():
        c = fs.raw()
        return isinstance(c, str), f"raw_content {len(c)} 字"

    check("正文可读", _readable)

    def _perm():
        root = fs.root_block()
        r = fs.insert(root, [txt("__know_selftest_probe__")], index=0)
        if r.get("code") != 0:
            return False, f"写入被拒：{r.get('code')} {r.get('msg')}"
        kids = fs.children(root)
        idx = [i for i, k in enumerate(kids) if block_text(k).strip() == "__know_selftest_probe__"]
        if not idx:
            return False, "写入成功但回读找不到探针块"
        d = fs.delete_range(root, idx[0], idx[0] + 1)
        left = [k for k in fs.children(root) if block_text(k).strip() == "__know_selftest_probe__"]
        return (d.get("code") == 0 and not left), f"插入+删除往返成功，残留 {len(left)} 块"

    check("编辑权限（最小写入往返）", _perm)

    def _idem():
        root = fs.root_block()
        kids = fs.children(root)
        i, j = find_section(kids, "1970-01-01")
        return i is None, "不存在的日期不误判为已有节"

    check("节定位逻辑", _idem)

    def _md_checker():
        import tempfile

        good = os.path.join(tempfile.mkdtemp(), "good.md")
        open(good, "w", encoding="utf-8").write("# ok\n\n1. 条目\n")
        p1, _ = check_md(good)
        bad = os.path.join(tempfile.mkdtemp(), "bad.md")
        open(bad, "wb").write(b"# bad\n\n" + b"\x00" * 4096)
        p2, _ = check_md(bad)
        fix_md(bad)
        p3, _ = check_md(bad)
        return (not p1 and bool(p2) and not p3), f"好文件 0 问题 / 坏文件 {len(p2)} 问题 / --fix 后 0 问题"

    check("md 填充检查器（含 --fix）", _md_checker)

    check("凭据不落仓", lambda: (
        not os.path.exists(os.path.join(os.getcwd(), "lark-daily.creds.json")),
        "仓内无凭据文件"))

    failed = [n for n, ok, _ in results if not ok]
    print()
    print(f"{len(results) - len(failed)}/{len(results)} PASS")
    if failed:
        print("未通过：" + ", ".join(failed))
        return EXIT_FAIL
    return EXIT_OK


def cmd_write(fs: Feishu, payload: dict, apply: bool) -> int:
    day = normalize_day(payload)
    root = fs.root_block()
    kids = fs.children(root)

    start, end = find_section(kids, day["date"])
    blocks = build_section(day)

    print(f"日期：{day['date']}（{day['weekday']}）")
    for key, title in SECTIONS:
        print(f"  {title}：{len(day[key])} 条")
    print(f"  合计条目：{sum(len(day[k]) for k, _ in SECTIONS)}")

    if start is None:
        idx = insertion_index(kids, day["date"])
        print(f"动作：新增整节，插入位置 index={idx}")
    else:
        idx = None
        print(f"动作：替换已有整节 blocks[{start}:{end}]（{end - start} 块）")

    if not apply:
        print("\n--- dry-run 预览（未写入）---")
        for b in blocks:
            name = BT_NAME.get(b["block_type"], "?")
            print(f"  [{name}] {block_text(b)}")
        print("\n确认无误后加 --apply 执行写入。")
        return EXIT_OK

    if start is not None:
        r = fs.delete_range(root, start, end)
        if r.get("code") != 0:
            print(f"删除旧节失败：{r.get('code')} {r.get('msg')}", file=sys.stderr)
            return EXIT_FAIL
        kids = fs.children(root)
        idx = insertion_index(kids, day["date"])

    r = fs.insert(root, blocks, index=idx)
    if r.get("code") != 0:
        print(f"写入失败：{r.get('code')} {r.get('msg')}", file=sys.stderr)
        return EXIT_FAIL

    # 回读核对
    kids2 = fs.children(root)
    s2, e2 = find_section(kids2, day["date"])
    if s2 is None:
        print("回读失败：找不到刚写入的日期节", file=sys.stderr)
        return EXIT_FAIL
    sec = kids2[s2:e2]
    got_h3 = [block_text(b) for b in sec if b.get("block_type") == BT_H3]
    got_items = sum(
        1 for b in sec if b.get("block_type") in (BT_ORDERED, BT_TEXT)
    )
    want_items = sum(len(day[k]) for k, _ in SECTIONS)

    print("\n--- 回读核对 ---")
    print(f"  日期节：{block_text(sec[0])}")
    print(f"  板块：{got_h3}")
    print(f"  正文块：{got_items}（期望 {want_items}）")
    print(f"  日期节总数：{sum(1 for b in kids2 if b.get('block_type') == BT_H2)}")

    ok = got_h3 == [t for _, t in SECTIONS] and got_items == want_items
    print("  结果：" + ("PASS" if ok else "FAIL"))
    return EXIT_OK if ok else EXIT_FAIL


def cmd_md(path: str, do_fix: bool) -> int:
    problems, stats = check_md(path)
    print(f"文件：{path}")
    print(f"字节：{stats.get('bytes', '?')}")
    if problems:
        print("状态：红")
        for p in problems:
            print(f"  - {p}")
        if do_fix:
            removed = fix_md(path)
            print(f"已修复，移除 {removed} 字节；复检：")
            p2, _ = check_md(path)
            print(f"  剩余问题：{len(p2)}")
            for p in p2:
                print(f"  - {p}")
            return EXIT_OK if not p2 else EXIT_FAIL
        print("加 --fix 修复。")
        return EXIT_FAIL
    print("状态：绿（0 问题）")
    return EXIT_OK


def main() -> int:
    ap = argparse.ArgumentParser(description="Know 日报双落点工具")
    ap.add_argument("--selftest", action="store_true")
    ap.add_argument("--file", help="日报 JSON 路径")
    ap.add_argument("--apply", action="store_true", help="真写入（默认 dry-run）")
    ap.add_argument("--md", help="仓内 md 路径（配合 --check/--fix）")
    ap.add_argument("--check", action="store_true")
    ap.add_argument("--fix", action="store_true")
    ap.add_argument("--creds", default=os.environ.get("KNOW_LARK_CREDS", DEFAULT_CREDS))
    args = ap.parse_args()

    if args.md:
        return cmd_md(args.md, args.fix)

    fs = Feishu(load_creds(args.creds))

    if args.selftest:
        return cmd_selftest(fs, args.creds)

    if not args.file:
        ap.print_help()
        return EXIT_UNMET

    with open(args.file, "r", encoding="utf-8") as fh:
        payload = json.load(fh)
    return cmd_write(fs, payload, args.apply)


if __name__ == "__main__":
    sys.exit(main())
