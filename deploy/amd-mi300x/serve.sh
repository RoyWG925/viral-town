#!/usr/bin/env bash
# Serve Gemma 4 31B IT with vLLM on one AMD Instinct MI300X (AMD Developer Cloud "vLLM Quick Start" droplet).
# UNTESTED for VIRAL (no GPU was provisioned: it needs the account owner's credit/payment). Flags follow AMD's
# Gemma 4 day-0 note and the vLLM Gemma 4 recipe; see README.md for sources and the staged plan.
set -euo pipefail
: "${VLLM_API_KEY:?set VLLM_API_KEY to a long random secret (the game server sends it as GEMMA_API_KEY)}"
IMAGE="${IMAGE:-vllm/vllm-openai-rocm:gemma4}"   # stage 1; try :latest if this tag is gone
MODEL="${MODEL:-google/gemma-4-31B-it}"

docker run -d --name gemma --ipc=host --network=host \
  --device=/dev/kfd --device=/dev/dri --group-add video \
  --security-opt seccomp=unconfined --shm-size 16G \
  -e HF_TOKEN="${HF_TOKEN:-}" \
  "$IMAGE" \
  vllm serve "$MODEL" \
    --attention-backend TRITON_ATTN \
    --max-model-len 8192 \
    --gpu-memory-utilization 0.90 \
    --max-num-seqs 16 \
    --enable-prefix-caching \
    --limit-mm-per-prompt '{"image":0,"audio":0}' \
    --api-key "$VLLM_API_KEY" \
    --port 8000

echo "waiting for the server (first start downloads ~60 GB of weights)…"
until curl -sf -H "Authorization: Bearer $VLLM_API_KEY" http://localhost:8000/v1/models >/dev/null; do sleep 10; done
echo "ready: http://<droplet-ip>:8000/v1  model: $MODEL"
