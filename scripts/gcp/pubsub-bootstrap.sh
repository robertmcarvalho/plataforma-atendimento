#!/usr/bin/env bash
# Create Pub/Sub topics and pull subscriptions for Cloud Run (dev-equivalent names).
# Prerequisites: gcloud auth, project set: gcloud config set project YOUR_PROJECT_ID
#
# Usage:
#   export GCP_PROJECT_ID=my-project
#   ./scripts/gcp/pubsub-bootstrap.sh
#
# Optional overrides (defaults match apps/*/.env.example):
#   TOPIC_INBOUND=whatsapp.inbound
#   TOPIC_STATUS=whatsapp.status
#   TOPIC_CAMPAIGN=campaign.dispatch
#   SUB_INBOUND=whatsapp.inbound-sub
#   SUB_STATUS=whatsapp.status-sub
#   SUB_CAMPAIGN=campaign.dispatch-sub

set -euo pipefail

: "${GCP_PROJECT_ID:?Set GCP_PROJECT_ID (e.g. export GCP_PROJECT_ID=my-project)}"

TOPIC_INBOUND="${TOPIC_INBOUND:-whatsapp.inbound}"
TOPIC_INBOUND_AUTO="${TOPIC_INBOUND_AUTO:-whatsapp.inbound.auto}"
TOPIC_STATUS="${TOPIC_STATUS:-whatsapp.status}"
TOPIC_CAMPAIGN="${TOPIC_CAMPAIGN:-campaign.dispatch}"
SUB_INBOUND="${SUB_INBOUND:-whatsapp.inbound-sub}"
SUB_INBOUND_AUTO="${SUB_INBOUND_AUTO:-whatsapp.inbound.auto-sub}"
SUB_STATUS="${SUB_STATUS:-whatsapp.status-sub}"
SUB_CAMPAIGN="${SUB_CAMPAIGN:-campaign.dispatch-sub}"
DLQ_TOPIC="${DLQ_TOPIC:-platform.dead-letter}"
MAX_DELIVERY_ATTEMPTS="${MAX_DELIVERY_ATTEMPTS:-5}"

gcloud pubsub topics describe "$DLQ_TOPIC" --project="$GCP_PROJECT_ID" &>/dev/null || \
  gcloud pubsub topics create "$DLQ_TOPIC" --project="$GCP_PROJECT_ID"

gcloud pubsub topics describe "$TOPIC_INBOUND" --project="$GCP_PROJECT_ID" &>/dev/null || \
  gcloud pubsub topics create "$TOPIC_INBOUND" --project="$GCP_PROJECT_ID"

gcloud pubsub topics describe "$TOPIC_INBOUND_AUTO" --project="$GCP_PROJECT_ID" &>/dev/null || \
  gcloud pubsub topics create "$TOPIC_INBOUND_AUTO" --project="$GCP_PROJECT_ID"

gcloud pubsub topics describe "$TOPIC_STATUS" --project="$GCP_PROJECT_ID" &>/dev/null || \
  gcloud pubsub topics create "$TOPIC_STATUS" --project="$GCP_PROJECT_ID"

gcloud pubsub topics describe "$TOPIC_CAMPAIGN" --project="$GCP_PROJECT_ID" &>/dev/null || \
  gcloud pubsub topics create "$TOPIC_CAMPAIGN" --project="$GCP_PROJECT_ID"

create_sub_with_dlq() {
  local sub_name="$1"
  local topic_name="$2"
  local ordering="${3:-false}"
  if gcloud pubsub subscriptions describe "$sub_name" --project="$GCP_PROJECT_ID" &>/dev/null; then
    if [ "$ordering" = "true" ]; then
      gcloud pubsub subscriptions update "$sub_name" \
        --project="$GCP_PROJECT_ID" \
        --enable-message-ordering \
        --dead-letter-topic="$DLQ_TOPIC" \
        --max-delivery-attempts="$MAX_DELIVERY_ATTEMPTS" \
        --dead-letter-topic-project="$GCP_PROJECT_ID" || true
    else
      gcloud pubsub subscriptions update "$sub_name" \
        --project="$GCP_PROJECT_ID" \
        --dead-letter-topic="$DLQ_TOPIC" \
        --max-delivery-attempts="$MAX_DELIVERY_ATTEMPTS" \
        --dead-letter-topic-project="$GCP_PROJECT_ID" || true
    fi
    return
  fi
  if [ "$ordering" = "true" ]; then
    gcloud pubsub subscriptions create "$sub_name" \
      --topic="$topic_name" \
      --project="$GCP_PROJECT_ID" \
      --enable-message-ordering \
      --dead-letter-topic="$DLQ_TOPIC" \
      --max-delivery-attempts="$MAX_DELIVERY_ATTEMPTS" \
      --dead-letter-topic-project="$GCP_PROJECT_ID"
  else
    gcloud pubsub subscriptions create "$sub_name" \
      --topic="$topic_name" \
      --project="$GCP_PROJECT_ID" \
      --dead-letter-topic="$DLQ_TOPIC" \
      --max-delivery-attempts="$MAX_DELIVERY_ATTEMPTS" \
      --dead-letter-topic-project="$GCP_PROJECT_ID"
  fi
}

create_sub_with_dlq "$SUB_INBOUND" "$TOPIC_INBOUND"
create_sub_with_dlq "$SUB_INBOUND_AUTO" "$TOPIC_INBOUND_AUTO" true
create_sub_with_dlq "$SUB_STATUS" "$TOPIC_STATUS"
create_sub_with_dlq "$SUB_CAMPAIGN" "$TOPIC_CAMPAIGN"

echo "OK Pub/Sub topics and subscriptions in project $GCP_PROJECT_ID"
echo "  topics:    $TOPIC_INBOUND, $TOPIC_INBOUND_AUTO (ordering), $TOPIC_STATUS, $TOPIC_CAMPAIGN, DLQ=$DLQ_TOPIC"
echo "  subs:      $SUB_INBOUND, $SUB_INBOUND_AUTO (ordering), $SUB_STATUS, $SUB_CAMPAIGN (max_delivery=$MAX_DELIVERY_ATTEMPTS)"
