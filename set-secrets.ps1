# NEXUS — GitHub Secrets Setup
# Run this once in PowerShell from any folder on your machine.
# Requires GitHub CLI: https://cli.github.com  (free, one-time install)
#
# Steps:
#   1. Install GitHub CLI from https://cli.github.com
#   2. Run:  gh auth login   (follow prompts, choose GitHub.com + HTTPS)
#   3. Right-click this file → "Run with PowerShell"

$repo = "iamarasinghe96/nexus"

$secrets = @{
    VITE_GROQ_API_KEY                = "PASTE-YOUR-NEW-GROQ-KEY-HERE"
    VITE_FIREBASE_API_KEY            = "AIzaSyA8PHidEvh7SfHijr5_OBsbtItEcE78Adk"
    VITE_FIREBASE_AUTH_DOMAIN        = "nexus-de0e0.firebaseapp.com"
    VITE_FIREBASE_PROJECT_ID         = "nexus-de0e0"
    VITE_FIREBASE_STORAGE_BUCKET     = "nexus-de0e0.firebasestorage.app"
    VITE_FIREBASE_MESSAGING_SENDER_ID = "87979276837"
    VITE_FIREBASE_APP_ID             = "1:87979276837:web:b6a94ae8eda73d82a69dcc"
}

Write-Host "`nNEXUS — Setting GitHub Secrets for $repo`n" -ForegroundColor Cyan

foreach ($name in $secrets.Keys) {
    $value = $secrets[$name]
    if ($value -like "PASTE-*") {
        Write-Host "  SKIPPED  $name  (replace placeholder first)" -ForegroundColor Yellow
        continue
    }
    $value | gh secret set $name --repo $repo
    Write-Host "  OK       $name" -ForegroundColor Green
}

Write-Host "`nDone. Go to github.com/$repo/actions and trigger the Deploy workflow.`n" -ForegroundColor Cyan
