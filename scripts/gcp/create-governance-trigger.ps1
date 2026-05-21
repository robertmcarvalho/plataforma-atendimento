# Creates a manual Cloud Build trigger (run from Console or gcloud builds triggers run).
# For GitHub-connected repo, link in Console: Cloud Build > Repositories, then:
#   gcloud builds triggers create github --name=plataforma-governance-check `
#     --repo-name=REPO --repo-owner=OWNER --branch-pattern=^main$ `
#     --build-config=deploy/cloudbuild-governance-check.yaml

param(
  [string]$ProjectId = $(if ($env:GCP_PROJECT_ID) { $env:GCP_PROJECT_ID } else { "rh-coopmob-bot" })
)

Write-Host "Manual run (no trigger required):"
Write-Host "  gcloud builds submit . --config=deploy/cloudbuild-governance-check.yaml --project=$ProjectId"
Write-Host ""
Write-Host "Gate API image build:"
Write-Host "  gcloud builds submit . --config=deploy/cloudbuild-flux-farma-api-gated.yaml --project=$ProjectId"
