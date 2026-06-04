Write-Host "Unblocking port 8085 for Expo Metro Bundler..."
$RuleName = "Expo Development Port 8085"

# Check if rule already exists
$existingRule = Get-NetFirewallRule -DisplayName $RuleName -ErrorAction SilentlyContinue

if ($existingRule) {
    Write-Host "Rule already exists! Removing old rule..."
    Remove-NetFirewallRule -DisplayName $RuleName
}

# Create new rule
Try {
    New-NetFirewallRule -DisplayName $RuleName -Direction Inbound -LocalPort 8085 -Protocol TCP -Action Allow -Profile Any -ErrorAction Stop
    Write-Host "Success! Port 8085 is now unblocked." -ForegroundColor Green
}
Catch {
    Write-Host "Failed to unblock port. Please ensure you are running this as Administrator." -ForegroundColor Red
}
