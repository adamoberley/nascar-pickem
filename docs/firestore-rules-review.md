# Firestore Security Rules Review

## Current Rules Coverage

### ✅ Covered Operations

1. **Collection Group Queries**
   - `collectionGroup("members")` - ✅ Has rule: `match /{path=**}/members/{userId}`
   - Allows users to read their own member documents across all leagues

2. **League Document**
   - Read: ✅ `isMember(leagueId)` check
   - Create: ✅ Blocked (only via Cloud Function)
   - Update/Delete: ✅ Admin only

3. **Members Collection** (`/leagues/{leagueId}/members/{userId}`)
   - Read: ✅ `isMember(leagueId)` - members can read all members
   - Create/Update/Delete: ✅ Admin only
   - Client update: `setMemberPaidStatus()` - ⚠️ **ISSUE**: Client tries to update but rule requires admin

4. **Races Collection** (`/leagues/{leagueId}/races/{raceId}`)
   - Read: ✅ `isMember(leagueId)`
   - Create/Update/Delete: ✅ Admin only

5. **Drivers Collection** (`/leagues/{leagueId}/drivers/{driverId}`)
   - Read: ✅ `isMember(leagueId)`
   - Create/Update/Delete: ✅ Admin only

6. **Tiers Collection** (`/leagues/{leagueId}/tiers/{raceId}`)
   - Read: ✅ `isMember(leagueId)`
   - Create/Update/Delete: ✅ Admin only

7. **Picks Collection** (`/leagues/{leagueId}/picks/{pickId}`)
   - Read: ✅ `isMember(leagueId)` AND (admin OR own pick)
   - Create: ✅ `pickWriteAllowed()` - checks member, own userId, valid shape, not locked
   - Update: ✅ `pickWriteAllowed()` AND same userId AND same raceId
   - Delete: ✅ Blocked

8. **Race Points** (`/leagues/{leagueId}/racePoints/{raceId}`)
   - Read: ✅ `isMember(leagueId)`
   - Create/Update/Delete: ✅ Admin only

9. **Adjustments** (`/leagues/{leagueId}/adjustments/{adjustmentId}`)
   - Read: ✅ `isMember(leagueId)`
   - Create/Update/Delete: ✅ Admin only

10. **Weekly Scores** (`/leagues/{leagueId}/weeklyScores/{scoreId}`)
    - Read: ✅ `isMember(leagueId)`
    - Create/Update/Delete: ✅ Blocked (only via Cloud Functions)

11. **Season Scores** (`/leagues/{leagueId}/seasonScores/{userId}`)
    - Read: ✅ `isMember(leagueId)`
    - Create/Update/Delete: ✅ Blocked (only via Cloud Functions)

12. **Users Collection** (`/users/{userId}`)
    - Read/Write: ✅ Own user document only

## ✅ All Rules Verified

### Issue 1: Client-Side Member Update
**Location**: `web/src/lib/api.ts:132` - `setMemberPaidStatus()`
**Status**: ✅ **VERIFIED** - Only called in admin tab (line 1052), protected by `isAdmin` check (line 957)
**Rule**: ✅ Correct - `allow update: if isAdmin(leagueId)`

### Issue 2: Client-Side League Update
**Location**: `web/src/lib/api.ts:145` - `setLeagueSettings()`
**Status**: ✅ **VERIFIED** - Only called in admin tab (line 975), protected by `isAdmin` check (line 957)
**Rule**: ✅ Correct - `allow update: if isAdmin(leagueId)`

### Issue 3: Collection Group Rules
**Status**: ✅ **FIXED** - Added rule for `members` collection group: `match /{path=**}/members/{userId}`

### Issue 4: Query Indexes
**Status**: ✅ **VERIFIED** - All queries are properly indexed:
1. **Picks Query**: `where("raceId", "==", ...) orderBy("updatedAt", "desc")`
   - ✅ Index exists: `picks` collection group with `raceId` ASC, `updatedAt` DESC

2. **Weekly Scores Query**: `where("userId", "==", ...)`
   - ✅ Single-field index automatically created by Firestore (no explicit index needed)

3. **Adjustments Query**: `where("raceId", "==", ...)`
   - ✅ Single-field index automatically created by Firestore (no explicit index needed)

4. **Races Query**: `orderBy("startTime", "asc")`
   - ✅ Single-field index automatically created by Firestore

5. **Members Query**: `orderBy("displayName", "asc")`
   - ✅ Single-field index automatically created by Firestore

6. **Season Scores Query**: `orderBy("rank", "asc")`
   - ✅ Index exists: `seasonScores` collection group with `rank` ASC

## Summary

✅ **All rules are correctly configured** - All operations are properly secured
✅ **All indexes are in place** - Composite indexes exist where needed, single-field indexes are automatic
✅ **Collection group query** for members is properly configured
✅ **Admin operations** are properly protected (both UI and Firestore rules)
✅ **User operations** (picks) are properly restricted with validation
✅ **Client-side updates** are properly restricted to admins only

## Final Verification Checklist

- ✅ Collection group query rule for `members` exists
- ✅ League read requires membership
- ✅ League create blocked (Cloud Function only)
- ✅ League update/delete requires admin
- ✅ Member read requires membership
- ✅ Member create/update/delete requires admin
- ✅ Picks can be created/updated by members (with validation)
- ✅ Picks can only be read by owner or admin
- ✅ All admin-only collections properly protected
- ✅ User document access restricted to own document
- ✅ All queries have proper indexes (composite or automatic single-field)
