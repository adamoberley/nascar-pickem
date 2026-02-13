# Firestore Index Setup

## Required Collection Group Index

For collection group queries on `members` filtered by `userId`, you need to create an index manually:

1. **Click this link** to create the index automatically:
   https://console.firebase.google.com/v1/r/project/nascar-pick-em/firestore/indexes?create_exemption=ClJwcm9qZWN0cy9uYXNjYXItcGljay1lbS9kYXRhYmFzZXMvKGRlZmF1bHQpL2NvbGxlY3Rpb25Hcm91cHMvbWVtYmVycy9maWVsZHMvdXNlcklkEAIaCgoGdXNlcklkEAE

2. **Or manually create it**:
   - Go to [Firebase Console](https://console.firebase.google.com/project/nascar-pick-em/firestore/indexes)
   - Click "Create Index"
   - Collection ID: `members` (Collection Group)
   - Fields to index:
     - Field: `userId`, Order: Ascending
   - Click "Create"

The index will take a few minutes to build. Once it's ready (status shows "Enabled"), the collection group queries will work.

## Alternative: Wait for Auto-Creation

Firestore may automatically create this index after the first query fails. You can:
1. Try the query again after a few minutes
2. Check the Firebase Console to see if the index was auto-created
3. If not, use the manual creation method above
