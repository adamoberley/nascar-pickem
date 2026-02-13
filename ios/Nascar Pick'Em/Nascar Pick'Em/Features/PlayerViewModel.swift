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
    @Published var allWeeklyScores: [WeeklyScoreItem] = []

    @Published var selectedRaceId: String?
    @Published var selectedRacePoints: [(String, Int)] = []
    @Published var selectedRaceScore: WeeklyScoreItem?
    @Published var selectedRacePick: PickItem?

    @Published var isLoading = false
    @Published var isSavingPick = false
    @Published var errorMessage: String?
    @Published var statusMessage: String?

    /// League member names for the join flow (from league preview).
    @Published var memberNamesForJoin: [String] = []
    @Published var leaguePreviewLoadingForJoin = false

    private let repository = LeagueRepository.shared
    private var listeners: [ListenerRegistration] = []
    private var tierListener: ListenerRegistration?
    private var pickListener: ListenerRegistration?
    private var allWeeklyScoresListener: ListenerRegistration?
    private var racePointsListener: ListenerRegistration?
    private var raceScoreListener: ListenerRegistration?
    private var selectedRacePickListener: ListenerRegistration?

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
            self?.members = members
        })

        listeners.append(repository.observeSeasonScores(leagueId: leagueId) { [weak self] scores in
            self?.seasonScores = scores
        })

        allWeeklyScoresListener = repository.observeAllWeeklyScores(leagueId: leagueId) { [weak self] scores in
            self?.allWeeklyScores = scores
        }

        observeTierAndPick()
        observeSelectedRaceDetails()
    }

    /// Fetches league preview (member names) for the join flow when user enters invite code.
    func fetchLeaguePreviewForJoin(inviteCode: String) {
        let code = inviteCode.trimmingCharacters(in: .whitespacesAndNewlines).uppercased()
        if code.count < 2 {
            memberNamesForJoin = []
            leaguePreviewLoadingForJoin = false
            return
        }
        leaguePreviewLoadingForJoin = true
        repository.getLeaguePreview(inviteCode: code) { [weak self] result in
            Task { @MainActor in
                guard let self else { return }
                self.leaguePreviewLoadingForJoin = false
                switch result {
                case .success(let preview):
                    self.memberNamesForJoin = preview.memberNames
                case .failure:
                    self.memberNamesForJoin = []
                }
            }
        }
    }

    func joinLeague(inviteCode: String, displayName: String) {
        isLoading = true
        repository.joinLeague(inviteCode: inviteCode, displayName: displayName) { [weak self] result in
            guard let self else { return }
            self.isLoading = false
            switch result {
            case .success:
                self.statusMessage = "Joined league successfully."
                DispatchQueue.main.asyncAfter(deadline: .now() + 2.0) {
                    self.loadMemberships()
                }
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

    func setSelectedRace(raceId: String) {
        selectedRaceId = raceId
        observeSelectedRaceDetails()
    }

    func savePick(tierA: [String], tierB: [String], tierC: [String]) {
        guard let leagueId = selectedLeague?.id,
              let raceId = upcomingRace?.id else {
            return
        }

        isSavingPick = true
        repository.savePick(
            leagueId: leagueId,
            raceId: raceId,
            tierA: tierA,
            tierB: tierB,
            tierC: tierC
        ) { [weak self] result in
            guard let self else { return }
            self.isSavingPick = false
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

    private func observeSelectedRaceDetails() {
        racePointsListener?.remove()
        raceScoreListener?.remove()
        selectedRacePickListener?.remove()
        racePointsListener = nil
        raceScoreListener = nil
        selectedRacePickListener = nil

        guard let leagueId = selectedLeague?.id,
              let raceId = selectedRaceId,
              let userId = currentUserId else {
            selectedRacePick = nil
            return
        }

        racePointsListener = repository.observeRacePoints(leagueId: leagueId, raceId: raceId) { [weak self] points in
            self?.selectedRacePoints = points
        }

        raceScoreListener = repository.observeWeeklyScore(leagueId: leagueId, raceId: raceId, userId: userId) { [weak self] score in
            self?.selectedRaceScore = score
        }

        selectedRacePickListener = repository.observePick(leagueId: leagueId, raceId: raceId, userId: userId) { [weak self] pick in
            self?.selectedRacePick = pick
        }
    }

    private func clearListeners() {
        listeners.forEach { $0.remove() }
        listeners.removeAll()
        tierListener?.remove()
        pickListener?.remove()
        allWeeklyScoresListener?.remove()
        racePointsListener?.remove()
        raceScoreListener?.remove()
        selectedRacePickListener?.remove()
        tierListener = nil
        pickListener = nil
        allWeeklyScoresListener = nil
        racePointsListener = nil
        raceScoreListener = nil
        selectedRacePickListener = nil
    }
}
