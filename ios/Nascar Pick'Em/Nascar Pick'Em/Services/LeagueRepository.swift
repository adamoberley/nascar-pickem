import Foundation
import FirebaseFirestore
import FirebaseFunctions

final class LeagueRepository {
    static let shared = LeagueRepository()

    private let db = Firestore.firestore()
    private let functions = Functions.functions()

    private init() {}

    func fetchMemberships(userId: String, completion: @escaping (Result<[(LeagueSummary, LeagueMember)], Error>) -> Void) {
        db.collectionGroup("members")
            .getDocuments { [weak self] snapshot, error in
                if let error {
                    completion(.failure(error))
                    return
                }

                guard let self, let docs = snapshot?.documents else {
                    completion(.success([]))
                    return
                }

                let group = DispatchGroup()
                var result: [(LeagueSummary, LeagueMember)] = []
                var firstError: Error?

                docs.forEach { memberDoc in
                    guard memberDoc.documentID == userId else {
                        return
                    }
                    guard let leagueRef = memberDoc.reference.parent.parent else {
                        return
                    }
                    let member = self.parseMember(document: memberDoc)

                    group.enter()
                    leagueRef.getDocument { leagueSnap, leagueError in
                        defer { group.leave() }
                        if let leagueError {
                            firstError = leagueError
                            return
                        }
                        guard let leagueSnap, let data = leagueSnap.data() else {
                            return
                        }

                        let league = LeagueSummary(
                            id: leagueSnap.documentID,
                            name: data.string("name"),
                            seasonYear: data.int("seasonYear"),
                            inviteCode: data.string("inviteCode"),
                            payoutConfigText: data.string("payoutConfigText")
                        )
                        result.append((league, member))
                    }
                }

                group.notify(queue: .main) {
                    if let firstError {
                        completion(.failure(firstError))
                        return
                    }

                    completion(.success(result.sorted { $0.0.name < $1.0.name }))
                }
            }
    }

    func joinLeague(inviteCode: String, displayName: String, completion: @escaping (Result<Void, Error>) -> Void) {
        functions.httpsCallable("joinLeagueByInvite").call([
            "inviteCode": inviteCode,
            "displayName": displayName,
        ]) { _, error in
            if let error {
                completion(.failure(error))
                return
            }
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
        functions.httpsCallable("createLeague").call([
            "name": name,
            "seasonYear": seasonYear,
            "inviteCode": inviteCode,
            "payoutConfigText": payoutConfigText,
        ]) { _, error in
            if let error {
                completion(.failure(error))
                return
            }
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

            onChange(
                LeagueSummary(
                    id: snapshot.documentID,
                    name: data.string("name"),
                    seasonYear: data.int("seasonYear"),
                    inviteCode: data.string("inviteCode"),
                    payoutConfigText: data.string("payoutConfigText")
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
                        status: status
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
                        team: data.string("team")
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
                        lockedAt: data.timestamp(for: "lockedAt")
                    )
                )
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
