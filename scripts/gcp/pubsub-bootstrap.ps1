# Pub/Sub topics, subscriptions and dead-letter (Windows).
param(
  [string]$ProjectId = $(if ($env:GCP_PROJECT_ID) { $env:GCP_PROJECT_ID } else { "rh-coopmob-bot" })
)

$ErrorActionPreference = "Stop"
$TOPIC_INBOUND = if ($env:TOPIC_INBOUND) { $env:TOPIC_INBOUND } else { "whatsapp.inbound" }
$TOPIC_STATUS = if ($env:TOPIC_STATUS) { $env:TOPIC_STATUS } else { "whatsapp.status" }
$TOPIC_CAMPAIGN = if ($env:TOPIC_CAMPAIGN) { $env:TOPIC_CAMPAIGN } else { "campaign.dispatch" }
$SUB_INBOUND = if ($env:SUB_INBOUND) { $env:SUB_INBOUND } else { "whatsapp.inbound-sub" }
$SUB_STATUS = if ($env:SUB_STATUS) { $env:SUB_STATUS } else { "whatsapp.status-sub" }
$SUB_CAMPAIGN = if ($env:SUB_CAMPAIGN) { $env:SUB_CAMPAIGN } else { "campaign.dispatch-sub" }
$DLQ_TOPIC = if ($env:DLQ_TOPIC) { $env:DLQ_TOPIC } else { "platform.dead-letter" }
$MAX_DELIVERY = if ($env:MAX_DELIVERY_ATTEMPTS) { $env:MAX_DELIVERY_ATTEMPTS } else { "5" }

function Ensure-Topic([string]$Name) {
  cmd /c "gcloud pubsub topics describe $Name --project=$ProjectId 2>nul" | Out-Null
  if ($LASTEXITCODE -ne 0) {
    cmd /c "gcloud pubsub topics create $Name --project=$ProjectId" | Out-Null
    Write-Host "Created topic $Name"
  }
}

function Ensure-Sub([string]$Sub, [string]$Topic) {
  cmd /c "gcloud pubsub subscriptions describe $Sub --project=$ProjectId 2>nul" | Out-Null
  if ($LASTEXITCODE -eq 0) {
    cmd /c "gcloud pubsub subscriptions update $Sub --project=$ProjectId --dead-letter-topic=$DLQ_TOPIC --max-delivery-attempts=$MAX_DELIVERY --dead-letter-topic-project=$ProjectId" | Out-Null
    Write-Host "Updated subscription $Sub (DLQ)"
  } else {
    cmd /c "gcloud pubsub subscriptions create $Sub --topic=$Topic --project=$ProjectId --dead-letter-topic=$DLQ_TOPIC --max-delivery-attempts=$MAX_DELIVERY --dead-letter-topic-project=$ProjectId" | Out-Null
    Write-Host "Created subscription $Sub (DLQ)"
  }
}

Ensure-Topic $DLQ_TOPIC
Ensure-Topic $TOPIC_INBOUND
Ensure-Topic $TOPIC_STATUS
Ensure-Topic $TOPIC_CAMPAIGN
Ensure-Sub $SUB_INBOUND $TOPIC_INBOUND
Ensure-Sub $SUB_STATUS $TOPIC_STATUS
Ensure-Sub $SUB_CAMPAIGN $TOPIC_CAMPAIGN
Write-Host "OK Pub/Sub bootstrap complete for project $ProjectId"
