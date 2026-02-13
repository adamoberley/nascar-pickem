# How to Add the members userId Index

## Steps to Create the Index

1. **Click the "Add index" button** (blue button in the top right of the Firebase Console)

2. **Fill in the index form:**
   - **Collection ID:** Type `members`
   - **Query scope:** Select **"Collection group"** (this is important - not "Collection")
   - **Fields to index:** Click "Add field"
     - **Field:** `userId`
     - **Order:** Ascending (↑)
   - Click "Create"

3. **Wait for the index to build:**
   - The index will show status "Building" initially
   - It usually takes 1-5 minutes to complete
   - Once it shows "Enabled", the queries will work

## Why You Need This

- The existing `members` index is scoped to "Collection" (single collection)
- Collection group queries need "Collection group" scope
- The new index allows querying `members` across all leagues filtered by `userId`

## Alternative: Use the Direct Link

You can also use this direct link to create the index:
https://console.firebase.google.com/v1/r/project/nascar-pick-em/firestore/indexes?create_exemption=ClJwcm9qZWN0cy9uYXNjYXItcGljay1lbS9kYXRhYmFzZXMvKGRlZmF1bHQpL2NvbGxlY3Rpb25Hcm91cHMvbWVtYmVycy9maWVsZHMvdXNlcklkEAIaCgoGdXNlcklkEAE
