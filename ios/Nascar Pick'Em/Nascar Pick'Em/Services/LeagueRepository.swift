import Foundation
import FirebaseFirestore
import FirebaseFunctions
import FirebaseAuth
import os.log

final class LeagueRepository {
    static let shared = LeagueRepository()

    private let db = Firestore.firestore()
    // Specify region to match Cloud Functions deployment (us-central1)
    private let functions = Functions.functions(region: "us-central1")
    private let logger = Logger(subsystem: "com.nascar.pickem", category: "LeagueRepository")

    private init() {
        logger.info("🔵 LeagueRepository initialized with region: us-central1")
    }

    func fetchMemberships(userId: String, completion: @escaping (Result<[(LeagueSummary, LeagueMember)], Error>) -> Void) {
        self.logger.info("🔵 Loading memberships for userId: \(userId)")
        NSLog("🔵 Loading memberships for userId: \(userId)")
        
        // Filter by userId field to match security rules
        // This allows the security rule to properly evaluate the collection group query
        db.collectionGroup("members")
            .whereField("userId", isEqualTo: userId)
            .getDocuments { [weak self] snapshot, error in
                guard let self = self else { return }
                
                if let error {
                    self.logger.error("❌ Collection group query error: \(error.localizedDescription, privacy: .public)")
                    NSLog("❌ Collection group query error: %@", error.localizedDescription)
                    completion(.failure(error))
                    return
                }

                guard let docs = snapshot?.documents else {
                    self.logger.info("⚠️ No documents returned from collection group query")
                    NSLog("⚠️ No documents returned from collection group query")
                    completion(.success([]))
                    return
                }

                self.logger.info("🔵 Collection group query returned \(docs.count) member documents")
                NSLog("🔵 Collection group query returned %d member documents", docs.count)

                // Documents are already filtered by userId in the query
                let userMemberDocs = docs
                self.logger.info("🔵 Found \(userMemberDocs.count) member documents for current user")
                NSLog("🔵 Found %d member documents for current user", userMemberDocs.count)

                let group = DispatchGroup()
                var result: [(LeagueSummary, LeagueMember)] = []
                var errors: [Error] = []

                userMemberDocs.forEach { memberDoc in
                    guard let leagueRef = memberDoc.reference.parent.parent else {
                        self.logger.warning("⚠️ Member document has no parent league")
                        NSLog("⚠️ Member document has no parent league")
                        return
                    }
                    
                    let leagueId = leagueRef.documentID
                    let member = self.parseMember(document: memberDoc)

                    group.enter()
                    self.logger.info("🔵 Attempting to read league: \(leagueId)")
                    NSLog("🔵 Attempting to read league: %@", leagueId)
                    
                    leagueRef.getDocument { leagueSnap, leagueError in
                        defer { group.leave() }
                        
                        if let leagueError {
                            self.logger.error("❌ Failed to read league \(leagueId): \(leagueError.localizedDescription, privacy: .public)")
                            NSLog("❌ Failed to read league %@: %@", leagueId, leagueError.localizedDescription)
                            errors.append(leagueError)
                            return
                        }
                        
                        guard let leagueSnap, leagueSnap.exists, let data = leagueSnap.data() else {
                            self.logger.warning("⚠️ League document does not exist or has no data: \(leagueId)")
                            NSLog("⚠️ League document does not exist or has no data: %@", leagueId)
                            return
                        }

                        self.logger.info("✅ Successfully read league: \(leagueId)")
                        NSLog("✅ Successfully read league: %@", leagueId)

                        let memberNames = (data["memberNames"] as? [String]) ?? (data["expectedMemberNames"] as? [String]) ?? []
                        let league = LeagueSummary(
                            id: leagueSnap.documentID,
                            name: data.string("name"),
                            seasonYear: data.int("seasonYear"),
                            inviteCode: data.string("inviteCode"),
                            payoutConfigText: data.string("payoutConfigText"),
                            memberNames: memberNames
                        )
                        result.append((league, member))
                    }
                }

                group.notify(queue: .main) {
                    // Only fail if we have errors AND no successful results
                    // This allows partial success (some leagues readable, some not)
                    if !errors.isEmpty && result.isEmpty {
                        self.logger.error("❌ All league reads failed. First error: \(errors.first!.localizedDescription, privacy: .public)")
                        NSLog("❌ All league reads failed. First error: %@", errors.first!.localizedDescription)
                        completion(.failure(errors.first!))
                        return
                    }
                    
                    if !errors.isEmpty {
                        self.logger.warning("⚠️ Some league reads failed (\(errors.count) errors), but \(result.count) succeeded")
                        NSLog("⚠️ Some league reads failed (%d errors), but %d succeeded", errors.count, result.count)
                    }

                    self.logger.info("✅ Loaded \(result.count) valid memberships")
                    NSLog("✅ Loaded %d valid memberships", result.count)
                    completion(.success(result.sorted { $0.0.name < $1.0.name }))
                }
            }
    }

    /// Fetches league name and member names for the join flow (auth required).
    func getLeaguePreview(inviteCode: String, completion: @escaping (Result<LeaguePreview, Error>) -> Void) {
        guard Auth.auth().currentUser != nil else {
            completion(.failure(NSError(domain: "LeagueRepository", code: -1, userInfo: [NSLocalizedDescriptionKey: "User must be signed in"])))
            return
        }
        functions.httpsCallable("getLeaguePreviewByInviteCode").call(["inviteCode": inviteCode.uppercased()]) { [weak self] result, error in
            if let error {
                self?.logger.error("❌ getLeaguePreview error: \(error.localizedDescription, privacy: .public)")
                completion(.failure(error))
                return
            }
            guard let data = result?.data as? [String: Any],
                  let leagueId = data["leagueId"] as? String,
                  let name = data["name"] as? String else {
                completion(.failure(NSError(domain: "LeagueRepository", code: -2, userInfo: [NSLocalizedDescriptionKey: "Invalid preview response"])))
                return
            }
            let memberNames = (data["memberNames"] as? [String]) ?? (data["expectedMemberNames"] as? [String]) ?? []
            completion(.success(LeaguePreview(leagueId: leagueId, name: name, memberNames: memberNames)))
        }
    }

    func joinLeague(inviteCode: String, displayName: String, completion: @escaping (Result<Void, Error>) -> Void) {
        // Verify user is authenticated
        guard let currentUser = Auth.auth().currentUser else {
            let error = NSError(
                domain: "LeagueRepository",
                code: -1,
                userInfo: [NSLocalizedDescriptionKey: "User must be signed in to join a league"]
            )
            self.logger.error("❌ joinLeague called but user is not authenticated")
            NSLog("❌ joinLeague: User not authenticated")
            completion(.failure(error))
            return
        }
        
        self.logger.info("🔵 Calling joinLeagueByInvite with inviteCode: \(inviteCode), userId: \(currentUser.uid)")
        NSLog("🔵 Calling joinLeagueByInvite - User: \(currentUser.uid), InviteCode: \(inviteCode)")
        
        functions.httpsCallable("joinLeagueByInvite").call([
            "inviteCode": inviteCode,
            "displayName": displayName,
        ]) { [weak self] result, error in
            guard let self = self else { return }
            
            if let error {
                // Log detailed error for debugging
                self.logger.error("❌ joinLeague error: \(error.localizedDescription, privacy: .public)")
                
                // Extract detailed error information
                var errorDetails: [String] = [error.localizedDescription]
                
                if let nsError = error as NSError? {
                    errorDetails.append("Domain: \(nsError.domain)")
                    errorDetails.append("Code: \(nsError.code)")
                    
                    // Check for Firebase Functions specific error details
                    let userInfo = nsError.userInfo
                    if !userInfo.isEmpty {
                        self.logger.error("Error UserInfo: \(String(describing: userInfo), privacy: .public)")
                        
                        // Extract nested error information
                        if let underlyingError = userInfo[NSUnderlyingErrorKey] as? NSError {
                            errorDetails.append("Underlying Error: \(underlyingError.localizedDescription)")
                            if !underlyingError.userInfo.isEmpty {
                                self.logger.error("Underlying UserInfo: \(String(describing: underlyingError.userInfo), privacy: .public)")
                            }
                        }
                        
                        // Check for Firebase Functions error details
                        if let details = userInfo["details"] {
                            errorDetails.append("Details: \(String(describing: details))")
                        }
                        
                        if let message = userInfo["message"] as? String {
                            errorDetails.append("Message: \(message)")
                        }
                    }
                }
                
                // Use NSLog for guaranteed console output
                NSLog("❌ joinLeague error details:\n%@", errorDetails.joined(separator: "\n"))
                
                // Create a more detailed error
                let detailedError = NSError(
                    domain: "LeagueRepository",
                    code: (error as NSError).code,
                    userInfo: [
                        NSLocalizedDescriptionKey: errorDetails.joined(separator: "\n")
                    ]
                )
                
                completion(.failure(detailedError))
                return
            }
            
            self.logger.info("✅ joinLeague success")
            completion(.success(()))
        }
    }

    func createLeague(
        name: String,
        seasonYear: Int,
        inviteCode: String,
        payoutConfigText: String,
        completion: @escaping (Result<Void, Error>) -> Void
    ) {
        // Verify user is authenticated
        guard let currentUser = Auth.auth().currentUser else {
            let error = NSError(
                domain: "LeagueRepository",
                code: -1,
                userInfo: [NSLocalizedDescriptionKey: "User must be signed in to create a league"]
            )
            self.logger.error("❌ createLeague called but user is not authenticated")
            NSLog("❌ createLeague: User not authenticated")
            completion(.failure(error))
            return
        }
        
        self.logger.info("🔵 Calling createLeague with name: \(name), inviteCode: \(inviteCode), userId: \(currentUser.uid)")
        NSLog("🔵 Calling createLeague - User: \(currentUser.uid), Name: \(name), InviteCode: \(inviteCode)")
        
        functions.httpsCallable("createLeague").call([
            "name": name,
            "seasonYear": seasonYear,
            "inviteCode": inviteCode,
            "payoutConfigText": payoutConfigText,
        ]) { [weak self] result, error in
            guard let self = self else { return }
            
            if let error {
                // Log detailed error for debugging
                self.logger.error("❌ createLeague error: \(error.localizedDescription, privacy: .public)")
                
                // Extract detailed error information
                var errorDetails: [String] = [error.localizedDescription]
                
                if let nsError = error as NSError? {
                    errorDetails.append("Domain: \(nsError.domain)")
                    errorDetails.append("Code: \(nsError.code)")
                    
                    // Check for Firebase Functions specific error details
                    let userInfo = nsError.userInfo
                    if !userInfo.isEmpty {
                        self.logger.error("Error UserInfo: \(String(describing: userInfo), privacy: .public)")
                        
                        // Extract nested error information
                        if let underlyingError = userInfo[NSUnderlyingErrorKey] as? NSError {
                            errorDetails.append("Underlying Error: \(underlyingError.localizedDescription)")
                            if !underlyingError.userInfo.isEmpty {
                                self.logger.error("Underlying UserInfo: \(String(describing: underlyingError.userInfo), privacy: .public)")
                            }
                        }
                        
                        // Check for Firebase Functions error details
                        if let details = userInfo["details"] {
                            errorDetails.append("Details: \(String(describing: details))")
                        }
                        
                        if let message = userInfo["message"] as? String {
                            errorDetails.append("Message: \(message)")
                        }
                    }
                }
                
                // Use NSLog for guaranteed console output
                NSLog("❌ createLeague error details:\n%@", errorDetails.joined(separator: "\n"))
                
                // Create a more detailed error
                let detailedError = NSError(
                    domain: "LeagueRepository",
                    code: (error as NSError).code,
                    userInfo: [
                        NSLocalizedDescriptionKey: errorDetails.joined(separator: "\n")
                    ]
                )
                
                completion(.failure(detailedError))
                return
            }
            
            self.logger.info("✅ createLeague success")
            completion(.success(()))
        }
    }

    func savePick(
        leagueId: String,
        raceId: String,
        tierA: [String],
        tierB: [String],
        tierC: [String],
        completion: @escaping (Result<Void, Error>) -> Void
    ) {
        functions.httpsCallable("savePick").call([
            "leagueId": leagueId,
            "raceId": raceId,
            "tierA": tierA,
            "tierB": tierB,
            "tierC": tierC,
        ]) { _, error in
            if let error {
                completion(.failure(error))
                return
            }
            completion(.success(()))
        }
    }

    func observeLeague(
        leagueId: String,
        onChange: @escaping (LeagueSummary?) -> Void
    ) -> ListenerRegistration {
        db.collection("leagues").document(leagueId).addSnapshotListener { snapshot, _ in
            guard let snapshot, let data = snapshot.data() else {
                onChange(nil)
                return
            }

            let memberNames = (data["memberNames"] as? [String]) ?? (data["expectedMemberNames"] as? [String]) ?? []
            onChange(
                LeagueSummary(
                    id: snapshot.documentID,
                    name: data.string("name"),
                    seasonYear: data.int("seasonYear"),
                    inviteCode: data.string("inviteCode"),
                    payoutConfigText: data.string("payoutConfigText"),
                    memberNames: memberNames
                )
            )
        }
    }

    func observeMember(
        leagueId: String,
        userId: String,
        onChange: @escaping (LeagueMember?) -> Void
    ) -> ListenerRegistration {
        db.collection("leagues").document(leagueId).collection("members").document(userId)
            .addSnapshotListener { snapshot, _ in
                guard let snapshot, snapshot.exists else {
                    onChange(nil)
                    return
                }
                onChange(self.parseMember(document: snapshot))
            }
    }

    func observeRaces(
        leagueId: String,
        onChange: @escaping ([RaceItem]) -> Void
    ) -> ListenerRegistration {
        db.collection("leagues")
            .document(leagueId)
            .collection("races")
            .order(by: "startTime", descending: false)
            .addSnapshotListener { snapshot, _ in
                let races = snapshot?.documents.compactMap { doc -> RaceItem? in
                    let data = doc.data()
                    guard let startTime = data.timestamp(for: "startTime"),
                          let lockTime = data.timestamp(for: "lockTime") else {
                        return nil
                    }

                    let status = RaceStatus(rawValue: data.string("status")) ?? .scheduled

                    return RaceItem(
                        id: doc.documentID,
                        name: data.string("name"),
                        track: data.string("track"),
                        weekIndex: data.int("weekIndex"),
                        startTime: startTime,
                        lockTime: lockTime,
                        status: status,
                        nascarRaceId: data["nascarRaceId"] as? Int,
                        tvChannel: { let s = data.string("tvChannel"); return s.isEmpty ? nil : s }()
                    )
                } ?? []

                onChange(races)
            }
    }

    func observeDrivers(
        leagueId: String,
        onChange: @escaping ([DriverItem]) -> Void
    ) -> ListenerRegistration {
        db.collection("leagues").document(leagueId).collection("drivers")
            .addSnapshotListener { snapshot, _ in
                let drivers: [DriverItem] = snapshot?.documents.map { doc in
                    let data = doc.data()
                    return DriverItem(
                        id: doc.documentID,
                        name: data.string("name"),
                        number: data.string("number"),
                        team: data.string("team"),
                        nascarDriverId: data["nascarDriverId"] as? Int
                    )
                } ?? []

                onChange(drivers)
            }
    }

    func observeTier(
        leagueId: String,
        raceId: String,
        onChange: @escaping (TierItem?) -> Void
    ) -> ListenerRegistration {
        db.collection("leagues").document(leagueId).collection("tiers").document(raceId)
            .addSnapshotListener { snapshot, _ in
                guard let snapshot, let data = snapshot.data() else {
                    onChange(nil)
                    return
                }

                onChange(
                    TierItem(
                        tierA: data.stringArray("tierA"),
                        tierB: data.stringArray("tierB"),
                        tierC: data.stringArray("tierC")
                    )
                )
            }
    }

    func observePick(
        leagueId: String,
        raceId: String,
        userId: String,
        onChange: @escaping (PickItem?) -> Void
    ) -> ListenerRegistration {
        db.collection("leagues").document(leagueId).collection("picks")
            .document("\(raceId)_\(userId)")
            .addSnapshotListener { snapshot, _ in
                guard let snapshot, let data = snapshot.data() else {
                    onChange(nil)
                    return
                }

                onChange(
                    PickItem(
                        raceId: data.string("raceId"),
                        userId: data.string("userId"),
                        tierA: data.stringArray("tierA"),
                        tierB: data.stringArray("tierB"),
                        tierC: data.stringArray("tierC"),
                        lockedAt: data.timestamp(for: "lockedAt"),
                        updatedAt: data.timestamp(for: "updatedAt")
                    )
                )
            }
    }

    func observeRacePicks(
        leagueId: String,
        raceId: String,
        onChange: @escaping ([PickItem]) -> Void
    ) -> ListenerRegistration {
        db.collection("leagues").document(leagueId).collection("picks")
            .whereField("raceId", isEqualTo: raceId)
            .addSnapshotListener { snapshot, _ in
                let picks: [PickItem] = snapshot?.documents.map { doc in
                    let data = doc.data()
                    return PickItem(
                        raceId: data.string("raceId"),
                        userId: data.string("userId"),
                        tierA: data.stringArray("tierA"),
                        tierB: data.stringArray("tierB"),
                        tierC: data.stringArray("tierC"),
                        lockedAt: data.timestamp(for: "lockedAt"),
                        updatedAt: data.timestamp(for: "updatedAt")
                    )
                } ?? []
                onChange(picks)
            }
    }

    func observeMembers(
        leagueId: String,
        onChange: @escaping ([LeagueMember]) -> Void
    ) -> ListenerRegistration {
        db.collection("leagues").document(leagueId).collection("members")
            .order(by: "displayName", descending: false)
            .addSnapshotListener { snapshot, _ in
                onChange(snapshot?.documents.map { self.parseMember(document: $0) } ?? [])
            }
    }

    func observeSeasonScores(
        leagueId: String,
        onChange: @escaping ([SeasonScoreItem]) -> Void
    ) -> ListenerRegistration {
        db.collection("leagues").document(leagueId).collection("seasonScores")
            .order(by: "rank", descending: false)
            .addSnapshotListener { snapshot, _ in
                let scores: [SeasonScoreItem] = snapshot?.documents.map { doc in
                    let data = doc.data()
                    return SeasonScoreItem(
                        id: doc.documentID,
                        seasonTotal: data.int("seasonTotal"),
                        rank: data.int("rank")
                    )
                } ?? []

                onChange(scores)
            }
    }

    func observeWeeklyScores(
        leagueId: String,
        userId: String,
        onChange: @escaping ([WeeklyScoreItem]) -> Void
    ) -> ListenerRegistration {
        db.collection("leagues").document(leagueId).collection("weeklyScores")
            .whereField("userId", isEqualTo: userId)
            .addSnapshotListener { snapshot, _ in
                let items = snapshot?.documents.map { self.parseWeeklyScore(document: $0) } ?? []
                onChange(items.sorted { $0.raceId < $1.raceId })
            }
    }

    /// Observes all weekly scores in the league (for sprint leaderboard computation).
    func observeAllWeeklyScores(
        leagueId: String,
        onChange: @escaping ([WeeklyScoreItem]) -> Void
    ) -> ListenerRegistration {
        db.collection("leagues").document(leagueId).collection("weeklyScores")
            .addSnapshotListener { snapshot, _ in
                let items = snapshot?.documents.map { self.parseWeeklyScore(document: $0) } ?? []
                onChange(items)
            }
    }

    func observeRacePoints(
        leagueId: String,
        raceId: String,
        onChange: @escaping ([(String, Int)]) -> Void
    ) -> ListenerRegistration {
        db.collection("leagues").document(leagueId).collection("racePoints")
            .document(raceId)
            .addSnapshotListener { snapshot, _ in
                guard let snapshot, let data = snapshot.data() else {
                    onChange([])
                    return
                }

                let points = (data["drivers"] as? [[String: Any]] ?? []).map {
                    ($0["driverId"] as? String ?? "", $0["basePoints"] as? Int ?? 0)
                }
                onChange(points.sorted { $0.1 > $1.1 })
            }
    }

    /// Observes full race points document (live lap/stage and running positions).
    func observeRacePointsDocument(
        leagueId: String,
        raceId: String,
        onChange: @escaping (RacePointsDocument) -> Void
    ) -> ListenerRegistration {
        db.collection("leagues").document(leagueId).collection("racePoints")
            .document(raceId)
            .addSnapshotListener { snapshot, _ in
                guard let snapshot, let data = snapshot.data() else {
                    onChange(.empty)
                    return
                }
                let driverMaps = data["drivers"] as? [[String: Any]] ?? []
                let drivers = driverMaps.map {
                    RacePointsDriverItem(
                        driverId: $0["driverId"] as? String ?? "",
                        basePoints: $0["basePoints"] as? Int ?? 0,
                        runningPosition: $0["runningPosition"] as? Int
                    )
                }
                let stageMap = data["liveStage"] as? [String: Any]
                let liveStage: (stageNum: Int, finishAtLap: Int)? = stageMap.flatMap { m in
                    guard let num = m["stageNum"] as? Int, let lap = m["finishAtLap"] as? Int else { return nil }
                    return (stageNum: num, finishAtLap: lap)
                }
                onChange(RacePointsDocument(
                    drivers: drivers,
                    liveLapNumber: data["liveLapNumber"] as? Int,
                    liveLapsInRace: data["liveLapsInRace"] as? Int,
                    liveStage: liveStage
                ))
            }
    }

    /// Observes latest standings snapshot (for tier fallback).
    func observeLatestStandingsSnapshot(
        leagueId: String,
        onChange: @escaping (StandingsSnapshotItem?) -> Void
    ) -> ListenerRegistration {
        db.collection("leagues").document(leagueId).collection("standingsSnapshots")
            .order(by: "asOfDate", descending: true)
            .limit(to: 1)
            .addSnapshotListener { snapshot, _ in
                guard let doc = snapshot?.documents.first else {
                    onChange(nil)
                    return
                }
                let data = doc.data()
                guard let driversRaw = data["drivers"] as? [[String: Any]] else {
                    onChange(nil)
                    return
                }
                let drivers = driversRaw.compactMap { m -> StandingEntryItem? in
                    guard let driverId = m["driverId"] as? String,
                          let position = m["position"] as? Int else { return nil }
                    return StandingEntryItem(driverId: driverId, position: position)
                }
                onChange(StandingsSnapshotItem(id: doc.documentID, drivers: drivers))
            }
    }

    /// Observes adjustments for a race (for results display).
    func observeAdjustments(
        leagueId: String,
        raceId: String,
        onChange: @escaping ([AdjustmentItem]) -> Void
    ) -> ListenerRegistration {
        db.collection("leagues").document(leagueId).collection("adjustments")
            .whereField("raceId", isEqualTo: raceId)
            .addSnapshotListener { snapshot, _ in
                let items = snapshot?.documents.compactMap { doc -> AdjustmentItem? in
                    let data = doc.data()
                    guard let driverId = data["driverId"] as? String,
                          let delta = data["deltaPoints"] as? Int else { return nil }
                    return AdjustmentItem(driverId: driverId, deltaPoints: delta)
                } ?? []
                onChange(items)
            }
    }

    func setLeagueSettings(
        leagueId: String,
        name: String,
        seasonYear: Int,
        payoutConfigText: String,
        completion: @escaping (Result<Void, Error>) -> Void
    ) {
        functions.httpsCallable("updateLeagueSettings").call([
            "leagueId": leagueId,
            "name": name,
            "seasonYear": seasonYear,
            "payoutConfigText": payoutConfigText,
        ]) { _, error in
            if let error {
                completion(.failure(error))
                return
            }
            completion(.success(()))
        }
    }

    func setMemberPaidStatus(
        leagueId: String,
        userId: String,
        paidStatus: String,
        completion: @escaping (Result<Void, Error>) -> Void
    ) {
        functions.httpsCallable("updateMemberPaidStatus").call([
            "leagueId": leagueId,
            "userId": userId,
            "paidStatus": paidStatus,
        ]) { _, error in
            if let error {
                completion(.failure(error))
                return
            }
            completion(.success(()))
        }
    }

    func observeWeeklyScore(
        leagueId: String,
        raceId: String,
        userId: String,
        onChange: @escaping (WeeklyScoreItem?) -> Void
    ) -> ListenerRegistration {
        db.collection("leagues").document(leagueId).collection("weeklyScores")
            .document("\(raceId)_\(userId)")
            .addSnapshotListener { snapshot, _ in
                guard let snapshot, snapshot.exists else {
                    onChange(nil)
                    return
                }
                onChange(self.parseWeeklyScore(document: snapshot))
            }
    }

    func runManualRefresh(leagueId: String, completion: @escaping (Result<Void, Error>) -> Void) {
        functions.httpsCallable("manualRefreshData").call(["leagueId": leagueId]) { _, error in
            if let error {
                completion(.failure(error))
                return
            }
            completion(.success(()))
        }
    }

    func syncLiveRaceNow(leagueId: String, completion: @escaping (Result<String, Error>) -> Void) {
        functions.httpsCallable("syncLiveRaceNow").call(["leagueId": leagueId]) { result, error in
            if let error {
                completion(.failure(error))
                return
            }
            let data = result?.data as? [String: Any]
            let updated = data?["updated"] as? Bool ?? false
            let reason = data?["reason"] as? String
            if updated {
                completion(.success("Live points updated from NASCAR.com."))
                return
            }
            completion(.success(reason ?? "No live race in progress or feed unavailable."))
        }
    }

    func manualUpsertRacePoints(
        leagueId: String,
        raceId: String,
        driverPoints: [(driverId: String, basePoints: Int)],
        completion: @escaping (Result<Void, Error>) -> Void
    ) {
        let payloadDrivers: [[String: Any]] = driverPoints.map {
            ["driverId": $0.driverId, "basePoints": $0.basePoints]
        }
        functions.httpsCallable("manualUpsertRacePoints").call([
            "leagueId": leagueId,
            "raceId": raceId,
            "drivers": payloadDrivers,
            "source": "ios-admin"
        ]) { _, error in
            if let error {
                completion(.failure(error))
                return
            }
            completion(.success(()))
        }
    }

    func submitAdjustment(
        leagueId: String,
        raceId: String,
        driverId: String,
        type: String,
        deltaPoints: Int,
        reason: String,
        completion: @escaping (Result<Void, Error>) -> Void
    ) {
        functions.httpsCallable("addAdjustment").call([
            "leagueId": leagueId,
            "raceId": raceId,
            "driverId": driverId,
            "type": type,
            "deltaPoints": deltaPoints,
            "reason": reason,
            "source": "ios-admin",
        ]) { _, error in
            if let error {
                completion(.failure(error))
                return
            }
            completion(.success(()))
        }
    }

    func observeNotifications(
        userId: String,
        onChange: @escaping ([UserNotificationItem]) -> Void
    ) -> ListenerRegistration {
        db.collection("users")
            .document(userId)
            .collection("notifications")
            .order(by: "createdAt", descending: true)
            .limit(to: 20)
            .addSnapshotListener { snapshot, _ in
                let notifications: [UserNotificationItem] = snapshot?.documents.map { doc in
                    let data = doc.data()
                    return UserNotificationItem(
                        id: doc.documentID,
                        type: data.string("type"),
                        leagueId: data.string("leagueId"),
                        raceId: data.string("raceId"),
                        title: data.string("title"),
                        message: data.string("message"),
                        lockTime: data.timestamp(for: "lockTime"),
                        createdAt: data.timestamp(for: "createdAt"),
                        readAt: data.timestamp(for: "readAt")
                    )
                } ?? []
                onChange(notifications)
            }
    }

    func markNotificationRead(
        userId: String,
        notificationId: String,
        completion: @escaping (Result<Void, Error>) -> Void
    ) {
        db.collection("users")
            .document(userId)
            .collection("notifications")
            .document(notificationId)
            .setData(["readAt": FieldValue.serverTimestamp()], merge: true) { error in
                if let error {
                    completion(.failure(error))
                    return
                }
                completion(.success(()))
            }
    }

    func upsertPushToken(
        token: String,
        deviceId: String,
        platform: String = "ios",
        completion: @escaping (Result<Void, Error>) -> Void
    ) {
        functions.httpsCallable("upsertPushToken").call([
            "token": token,
            "deviceId": deviceId,
            "platform": platform,
        ]) { _, error in
            if let error {
                completion(.failure(error))
                return
            }
            completion(.success(()))
        }
    }

    func removePushToken(
        token: String,
        deviceId: String?,
        completion: @escaping (Result<Void, Error>) -> Void
    ) {
        var payload: [String: Any] = ["token": token]
        if let deviceId, !deviceId.isEmpty {
            payload["deviceId"] = deviceId
        }
        functions.httpsCallable("removePushToken").call(payload) { _, error in
            if let error {
                completion(.failure(error))
                return
            }
            completion(.success(()))
        }
    }

    private func parseMember(document: DocumentSnapshot) -> LeagueMember {
        let data = document.data() ?? [:]
        return LeagueMember(
            id: document.documentID,
            displayName: data.string("displayName"),
            role: MemberRole(rawValue: data.string("role")) ?? .player,
            paidStatus: PaidStatus(rawValue: data.string("paidStatus")) ?? .unpaid
        )
    }

    private func parseWeeklyScore(document: DocumentSnapshot) -> WeeklyScoreItem {
        let data = document.data() ?? [:]
        let breakdownItems = (data["breakdown"] as? [[String: Any]] ?? []).map {
            WeeklyScoreItem.BreakdownItem(
                driverId: $0["driverId"] as? String ?? "",
                basePoints: $0["basePoints"] as? Int ?? 0,
                totalAdjustments: $0["totalAdjustments"] as? Int ?? 0,
                finalPointsApplied: $0["finalPointsApplied"] as? Int ?? 0,
                adjusted: $0["adjusted"] as? Bool ?? false
            )
        }

        return WeeklyScoreItem(
            raceId: data.string("raceId"),
            userId: data.string("userId"),
            weeklyTotal: data.int("weeklyTotal"),
            hasAdjustments: data["hasAdjustments"] as? Bool ?? false,
            breakdown: breakdownItems
        )
    }
}
