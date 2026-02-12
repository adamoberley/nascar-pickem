import Foundation
import Combine
import FirebaseAuth
import FirebaseFirestore

@MainActor
final class PlayerViewModel: ObservableObject {
    @Published var memberships: [(LeagueSummary, LeagueMember)] = []
    @Published var selectedLeague: LeagueSummary?
    @Published var selectedMember: LeagueMember?

    @Published var races: [RaceItem] = []
    @Published var drivers: [DriverItem] = []
    @Published var tier: TierItem?
    @Published var currentPick: PickItem?

    @Published var seasonScores: [SeasonScoreItem] = []
    @Published var members: [LeagueMember] = []
    @Published var selectedStandingsMemberId: String?
    @Published var selectedMemberWeeklyScores: [WeeklyScoreItem] = []

    @Published var selectedRaceId: String?
    @Published var selectedRacePoints: [(String, Int)] = []
    @Published var selectedRaceScore: WeeklyScoreItem?

    @Published var isLoading = false
    @Published var errorMessage: String?
    @Published var statusMessage: String?

    private let repository = LeagueRepository.shared
    private var listeners: [ListenerRegistration] = []
    private var tierListener: ListenerRegistration?
    private var pickListener: ListenerRegistration?
    private var standingsListener: ListenerRegistration?
    private var racePointsListener: ListenerRegistration?
    private var raceScoreListener: ListenerRegistration?

    var currentUserId: String? {
        Auth.auth().currentUser?.uid
    }

    var upcomingRace: RaceItem? {
        races.first { race in
            race.status == .scheduled && race.lockTime.timeIntervalSinceNow > 0
        } ?? races.first { $0.status == .scheduled }
    }

    var selectedRace: RaceItem? {
        guard let selectedRaceId else {
            return races.last(where: { $0.status == .completed }) ?? upcomingRace
        }
        return races.first(where: { $0.id == selectedRaceId })
    }

    var isPickLocked: Bool {
        guard let upcomingRace else {
            return true
        }
        return upcomingRace.status != .scheduled || upcomingRace.lockTime <= Date()
    }

    var driversById: [String: DriverItem] {
        Dictionary(uniqueKeysWithValues: drivers.map { ($0.id, $0) })
    }

    func loadMemberships() {
        guard let userId = currentUserId else {
            memberships = []
            selectedLeague = nil
            selectedMember = nil
            return
        }

        isLoading = true
        repository.fetchMemberships(userId: userId) { [weak self] result in
            guard let self else { return }
            self.isLoading = false
            switch result {
            case .success(let entries):
                self.memberships = entries
                if let first = entries.first {
                    self.applyLeagueSelection(leagueId: first.0.id)
                }
            case .failure(let error):
                self.errorMessage = error.localizedDescription
            }
        }
    }

    func applyLeagueSelection(leagueId: String) {
        clearListeners()

        guard let userId = currentUserId,
              let pair = memberships.first(where: { $0.0.id == leagueId }) else {
            return
        }

        selectedLeague = pair.0
        selectedMember = pair.1

        listeners.append(repository.observeLeague(leagueId: leagueId) { [weak self] league in
            guard let self, let league else { return }
            self.selectedLeague = league
        })

        listeners.append(repository.observeMember(leagueId: leagueId, userId: userId) { [weak self] member in
            guard let self else { return }
            self.selectedMember = member
        })

        listeners.append(repository.observeRaces(leagueId: leagueId) { [weak self] races in
            guard let self else { return }
            self.races = races
            if self.selectedRaceId == nil {
                self.selectedRaceId = races.last(where: { $0.status == .completed })?.id ?? races.first?.id
            }
            self.observeTierAndPick()
            self.observeSelectedRaceDetails()
        })

        listeners.append(repository.observeDrivers(leagueId: leagueId) { [weak self] drivers in
            self?.drivers = drivers
        })

        listeners.append(repository.observeMembers(leagueId: leagueId) { [weak self] members in
            guard let self else { return }
            self.members = members
            if self.selectedStandingsMemberId == nil {
                self.selectedStandingsMemberId = members.first?.id
                self.observeSelectedStandingsMember()
            }
        })

        listeners.append(repository.observeSeasonScores(leagueId: leagueId) { [weak self] scores in
            self?.seasonScores = scores
        })

        observeTierAndPick()
        observeSelectedStandingsMember()
        observeSelectedRaceDetails()
    }

    func joinLeague(inviteCode: String, displayName: String) {
        isLoading = true
        repository.joinLeague(inviteCode: inviteCode, displayName: displayName) { [weak self] result in
            guard let self else { return }
            self.isLoading = false
            switch result {
            case .success:
                self.statusMessage = "Joined league successfully."
                self.loadMemberships()
            case .failure(let error):
                self.errorMessage = error.localizedDescription
            }
        }
    }

    func createLeague(name: String, seasonYear: Int, inviteCode: String, payoutConfigText: String) {
        isLoading = true
        repository.createLeague(
            name: name,
            seasonYear: seasonYear,
            inviteCode: inviteCode,
            payoutConfigText: payoutConfigText
        ) { [weak self] result in
            guard let self else { return }
            self.isLoading = false
            switch result {
            case .success:
                self.statusMessage = "League created successfully."
                self.loadMemberships()
            case .failure(let error):
                self.errorMessage = error.localizedDescription
            }
        }
    }

    func observeStandingsUser(userId: String) {
        selectedStandingsMemberId = userId
        observeSelectedStandingsMember()
    }

    func setSelectedRace(raceId: String) {
        selectedRaceId = raceId
        observeSelectedRaceDetails()
    }

    func savePick(tierA: [String], tierB: [String], tierC: [String]) {
        guard let leagueId = selectedLeague?.id,
              let raceId = upcomingRace?.id else {
            return
        }

        isLoading = true
        repository.savePick(
            leagueId: leagueId,
            raceId: raceId,
            tierA: tierA,
            tierB: tierB,
            tierC: tierC
        ) { [weak self] result in
            guard let self else { return }
            self.isLoading = false
            switch result {
            case .success:
                self.statusMessage = "Picks saved."
            case .failure(let error):
                self.errorMessage = error.localizedDescription
            }
        }
    }

    func clearMessages() {
        errorMessage = nil
        statusMessage = nil
    }

    private func observeTierAndPick() {
        tierListener?.remove()
        pickListener?.remove()
        tierListener = nil
        pickListener = nil

        guard let leagueId = selectedLeague?.id,
              let raceId = upcomingRace?.id,
              let userId = currentUserId else {
            return
        }

        tierListener = repository.observeTier(leagueId: leagueId, raceId: raceId) { [weak self] tier in
            self?.tier = tier
        }

        pickListener = repository.observePick(leagueId: leagueId, raceId: raceId, userId: userId) { [weak self] pick in
            self?.currentPick = pick
        }
    }

    private func observeSelectedStandingsMember() {
        standingsListener?.remove()
        standingsListener = nil

        guard let leagueId = selectedLeague?.id,
              let selectedStandingsMemberId else {
            return
        }

        standingsListener = repository.observeWeeklyScores(leagueId: leagueId, userId: selectedStandingsMemberId) { [weak self] scores in
            self?.selectedMemberWeeklyScores = scores
        }
    }

    private func observeSelectedRaceDetails() {
        racePointsListener?.remove()
        raceScoreListener?.remove()
        racePointsListener = nil
        raceScoreListener = nil

        guard let leagueId = selectedLeague?.id,
              let raceId = selectedRaceId,
              let userId = currentUserId else {
            return
        }

        racePointsListener = repository.observeRacePoints(leagueId: leagueId, raceId: raceId) { [weak self] points in
            self?.selectedRacePoints = points
        }

        raceScoreListener = repository.observeWeeklyScore(leagueId: leagueId, raceId: raceId, userId: userId) { [weak self] score in
            self?.selectedRaceScore = score
        }
    }

    private func clearListeners() {
        listeners.forEach { $0.remove() }
        listeners.removeAll()
        tierListener?.remove()
        pickListener?.remove()
        standingsListener?.remove()
        racePointsListener?.remove()
        raceScoreListener?.remove()
        tierListener = nil
        pickListener = nil
        standingsListener = nil
        racePointsListener = nil
        raceScoreListener = nil
    }
}
