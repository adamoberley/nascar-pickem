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
}

struct DriverItem: Identifiable {
    let id: String
    let name: String
    let number: String
    let team: String
}

struct TierItem {
    let tierA: [String]
    let tierB: [String]
    let tierC: [String]
}

struct PickItem {
    let raceId: String
    let userId: String
    let tierA: [String]
    let tierB: [String]
    let tierC: [String]
    let lockedAt: Date?
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
