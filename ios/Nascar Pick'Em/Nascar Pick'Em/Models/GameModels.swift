import Foundation
import FirebaseFirestore

enum MemberRole: String {
    case admin
    case player
}

enum PaidStatus: String {
    case paid
    case unpaid
}

enum RaceStatus: String {
    case scheduled
    case locked
    case completed
}

struct LeagueSummary: Identifiable {
    let id: String
    let name: String
    let seasonYear: Int
    let inviteCode: String
    let payoutConfigText: String
    let memberNames: [String]
}

/// Preview of a league by invite code (for join flow name picker).
struct LeaguePreview {
    let leagueId: String
    let name: String
    let memberNames: [String]
}

struct LeagueMember: Identifiable {
    let id: String
    let displayName: String
    let role: MemberRole
    let paidStatus: PaidStatus
}

struct RaceItem: Identifiable {
    let id: String
    let name: String
    let track: String
    let weekIndex: Int
    let startTime: Date
    let lockTime: Date
    let status: RaceStatus
    let nascarRaceId: Int?
    let tvChannel: String?
}

struct DriverItem: Identifiable {
    let id: String
    let name: String
    let number: String
    let team: String
    let nascarDriverId: Int?
}

struct TierItem {
    let tierA: [String]
    let tierB: [String]
    let tierC: [String]
}

struct PickItem: Equatable {
    let raceId: String
    let userId: String
    let tierA: [String]
    let tierB: [String]
    let tierC: [String]
    let lockedAt: Date?
    let updatedAt: Date?
}

struct WeeklyScoreItem: Identifiable {
    struct BreakdownItem: Identifiable {
        var id: String { driverId }
        let driverId: String
        let basePoints: Int
        let totalAdjustments: Int
        let finalPointsApplied: Int
        let adjusted: Bool
    }

    var id: String { "\(raceId)_\(userId)" }
    let raceId: String
    let userId: String
    let weeklyTotal: Int
    let hasAdjustments: Bool
    let breakdown: [BreakdownItem]
}

struct SeasonScoreItem: Identifiable {
    let id: String
    let seasonTotal: Int
    let rank: Int
}

/// One driver entry in race points (base points; optional running position when live).
struct RacePointsDriverItem {
    let driverId: String
    let basePoints: Int
    /// Current running position (1-based) when from live feed.
    let runningPosition: Int?
}

/// Full race points document for a race (supports live lap/stage and running positions).
struct RacePointsDocument {
    let drivers: [RacePointsDriverItem]
    var liveLapNumber: Int?
    var liveLapsInRace: Int?
    var liveStage: (stageNum: Int, finishAtLap: Int)?

    static var empty: RacePointsDocument { RacePointsDocument(drivers: [], liveLapNumber: nil, liveLapsInRace: nil, liveStage: nil) }
}

/// Standings snapshot entry (driver position for tier computation).
struct StandingEntryItem {
    let driverId: String
    let position: Int
}

/// Latest standings snapshot for tier fallback when tier doc is missing.
struct StandingsSnapshotItem {
    let id: String
    let drivers: [StandingEntryItem]
}

/// Adjustment applied to a driver's points for a race.
struct AdjustmentItem {
    let driverId: String
    let deltaPoints: Int
}

struct UserNotificationItem: Identifiable {
    let id: String
    let type: String
    let leagueId: String
    let raceId: String
    let title: String
    let message: String
    let lockTime: Date?
    let createdAt: Date?
    let readAt: Date?

    var isRead: Bool { readAt != nil }
}

/// A row in the merged standings (real members + member names not yet joined).
struct StandingsRowItem: Identifiable {
    let id: String
    let displayName: String
    let seasonTotal: Int
    let rank: Int
    let isPlaceholder: Bool
}

extension Dictionary where Key == String, Value == Any {
    func timestamp(for key: String) -> Date? {
        guard let timestamp = self[key] as? Timestamp else {
            return nil
        }
        return timestamp.dateValue()
    }

    func string(_ key: String) -> String {
        self[key] as? String ?? ""
    }

    func int(_ key: String) -> Int {
        self[key] as? Int ?? 0
    }

    func stringArray(_ key: String) -> [String] {
        self[key] as? [String] ?? []
    }
}
