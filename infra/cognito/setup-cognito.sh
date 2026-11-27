#!/usr/bin/env bash
# Creates the login system for the whole app in Floci (Amazon Cognito). Safe to run again.
#   User pool  : tour-booking-users  (people sign in with their email + password)
#   App client : tour-booking-web    (used by the website: no client secret, password sign-in)
#   Groups     : staff, customers    (the role of each user)
#   Demo users : one staff user and one customer user
# The passwords are NOT written in this file. Run from the project folder like this:
#   STAFF_PASSWORD='...' CUSTOMER_PASSWORD='...' bash infra/cognito/setup-cognito.sh
export AWS_PROFILE=floci AWS_PAGER="" MSYS_NO_PATHCONV=1
cd "$(dirname "$0")/../.." || exit 1

POOL_NAME=tour-booking-users
CLIENT_NAME=tour-booking-web
STAFF_EMAIL=${STAFF_EMAIL:-staff@tourbooking.test}
CUSTOMER_EMAIL=${CUSTOMER_EMAIL:-customer@tourbooking.test}

if [ -z "$STAFF_PASSWORD" ] || [ -z "$CUSTOMER_PASSWORD" ]; then
  echo "Please give the two demo passwords (8+ characters, with upper case, lower case, a number and a symbol):"
  echo "  STAFF_PASSWORD='...' CUSTOMER_PASSWORD='...' bash infra/cognito/setup-cognito.sh"
  exit 1
fi

echo "1/4 User pool: $POOL_NAME"
POOL_ID=$(aws cognito-idp list-user-pools --max-results 60 \
  --query "UserPools[?Name=='$POOL_NAME'].Id | [0]" --output text)
if [ -z "$POOL_ID" ] || [ "$POOL_ID" = "None" ]; then
  POOL_ID=$(aws cognito-idp create-user-pool --pool-name $POOL_NAME \
    --username-attributes email --auto-verified-attributes email \
    --policies "PasswordPolicy={MinimumLength=8,RequireUppercase=true,RequireLowercase=true,RequireNumbers=true,RequireSymbols=true}" \
    --query UserPool.Id --output text) || exit 1
else
  echo "   (already exists)"
fi
echo "   $POOL_ID"

echo "2/4 App client: $CLIENT_NAME"
CLIENT_ID=$(aws cognito-idp list-user-pool-clients --user-pool-id $POOL_ID --max-results 60 \
  --query "UserPoolClients[?ClientName=='$CLIENT_NAME'].ClientId | [0]" --output text)
if [ -z "$CLIENT_ID" ] || [ "$CLIENT_ID" = "None" ]; then
  CLIENT_ID=$(aws cognito-idp create-user-pool-client --user-pool-id $POOL_ID --client-name $CLIENT_NAME \
    --no-generate-secret \
    --explicit-auth-flows ALLOW_USER_PASSWORD_AUTH ALLOW_REFRESH_TOKEN_AUTH \
    --prevent-user-existence-errors ENABLED \
    --query UserPoolClient.ClientId --output text) || exit 1
else
  echo "   (already exists)"
fi
echo "   $CLIENT_ID"

echo "3/4 Groups: staff, customers"
aws cognito-idp create-group --user-pool-id $POOL_ID --group-name staff \
  --description "Staff: review requests and manage packages" > /dev/null 2>&1 || echo "   (staff already exists)"
aws cognito-idp create-group --user-pool-id $POOL_ID --group-name customers \
  --description "Customers: book tours and see their own requests" > /dev/null 2>&1 || echo "   (customers already exists)"

echo "4/4 Demo users"
add_user() {   # $1 = email, $2 = password, $3 = group
  if ! aws cognito-idp admin-get-user --user-pool-id $POOL_ID --username "$1" > /dev/null 2>&1; then
    aws cognito-idp admin-create-user --user-pool-id $POOL_ID --username "$1" \
      --user-attributes Name=email,Value="$1" Name=email_verified,Value=true \
      --message-action SUPPRESS > /dev/null || return 1
  fi
  aws cognito-idp admin-set-user-password --user-pool-id $POOL_ID --username "$1" \
    --password "$2" --permanent || return 1
  aws cognito-idp admin-add-user-to-group --user-pool-id $POOL_ID --username "$1" --group-name "$3" || return 1
  echo "   $1 -> group $3"
}
add_user "$STAFF_EMAIL" "$STAFF_PASSWORD" staff || exit 1
add_user "$CUSTOMER_EMAIL" "$CUSTOMER_PASSWORD" customers || exit 1

# The website needs the pool and client IDs (they are not secret: every Cognito website shows them)
cat > Frontend/js/auth-config.js <<CONFIG
// Login settings (Amazon Cognito on Floci). Written by infra/cognito/setup-cognito.sh. Not secret.
const COGNITO_URL = "http://localhost:4566";
const COGNITO_USER_POOL_ID = "$POOL_ID";
const COGNITO_CLIENT_ID = "$CLIENT_ID";
CONFIG

echo ""
echo "Done."
echo "User pool ID: $POOL_ID"
echo "Client ID:    $CLIENT_ID"
echo "Wrote Frontend/js/auth-config.js"