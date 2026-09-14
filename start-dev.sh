#!/bin/sh
# 本地 dev（带生成链路过程日志）：SITECRAFT_LOG_GENERATION=1 让每次 AI 生成写 .sitecraft-data/logs/generation/*.jsonl
# 不开它就只能靠猜——2026-09-12 的 partial 排查卡在这里过。
cd /d/sitecraft-ai || exit 1
exec npm run dev
