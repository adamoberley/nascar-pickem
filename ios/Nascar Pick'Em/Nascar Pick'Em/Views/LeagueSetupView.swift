import SwiftUI

struct LeagueSetupView: View {
    @EnvironmentObject private var viewModel: PlayerViewModel
    @EnvironmentObject private var sessionStore: SessionStore
    @Environment(\.colorScheme) private var colorScheme

    private enum Field {
        case displayName
        case inviteCode
        case leagueName
        case newInviteCode
        case payoutNotes
    }

    @State private var displayName = ""
    @State private var inviteCode = ""
    /// Selected name from league member list (empty = none selected).
    @State private var selectedExpectedName: String = ""

    @State private var leagueName = ""
    @State private var seasonYear = Calendar.current.component(.year, from: Date())
    @State private var newInviteCode = ""
    @State private var payoutConfigText = ""
    @FocusState private var focusedField: Field?

    private var effectiveDisplayName: String {
        if !viewModel.memberNamesForJoin.isEmpty {
            return selectedExpectedName
        }
        return displayName.trimmingCharacters(in: .whitespacesAndNewlines)
    }

    private var canJoin: Bool {
        !inviteCode.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty &&
            (viewModel.memberNamesForJoin.isEmpty
                ? !displayName.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
                : !selectedExpectedName.isEmpty)
    }

    private var canCreate: Bool {
        !leagueName.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty &&
            !newInviteCode.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
    }

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(spacing: 18) {
                    VStack(alignment: .leading, spacing: 14) {
                        Text("JOIN LEAGUE")
                            .font(NASCARTheme.displayFont(size: 25, weight: .bold))
                            .textCase(.uppercase)

                        Text("Use your invite code to connect to an existing NASCAR Pick'Em league.")
                            .font(NASCARTheme.textFont(size: 15))
                            .foregroundStyle(.secondary)

                        VStack(alignment: .leading, spacing: 10) {
                            Text("Invite Code")
                                .font(NASCARTheme.textFont(size: 15, weight: .semibold))
                            TextField("RACER-2026", text: $inviteCode)
                                .textInputAutocapitalization(.characters)
                                .textFieldStyle(.plain)
                                .focused($focusedField, equals: .inviteCode)
                                .appInputField()
                                .onChange(of: inviteCode) { _, newValue in
                                    selectedExpectedName = ""
                                    viewModel.fetchLeaguePreviewForJoin(inviteCode: newValue)
                                }

                            if !viewModel.memberNamesForJoin.isEmpty {
                                Text("Your name")
                                    .font(NASCARTheme.textFont(size: 15, weight: .semibold))
                                Picker("Choose your name", selection: $selectedExpectedName) {
                                    Text("— Select your name —").tag("")
                                    ForEach(viewModel.memberNamesForJoin, id: \.self) { name in
                                        Text(name).tag(name)
                                    }
                                }
                                .pickerStyle(.menu)
                            } else {
                                Text("Display Name")
                                    .font(NASCARTheme.textFont(size: 15, weight: .semibold))
                                TextField("Your name", text: $displayName)
                                    .textFieldStyle(.plain)
                                    .focused($focusedField, equals: .displayName)
                                    .appInputField()
                            }
                        }

                        Button("Join League") {
                            focusedField = nil
                            viewModel.clearMessages()
                            viewModel.joinLeague(
                                inviteCode: inviteCode.uppercased(),
                                displayName: effectiveDisplayName
                            )
                        }
                        .buttonStyle(BrandYellowButtonStyle())
                        .disabled(!canJoin || viewModel.isLoading)
                    }
                    .appCard()

                    VStack(alignment: .leading, spacing: 14) {
                        Text("CREATE LEAGUE")
                            .font(NASCARTheme.displayFont(size: 25, weight: .bold))
                            .textCase(.uppercase)

                        VStack(alignment: .leading, spacing: 10) {
                            Text("League Name")
                                .font(NASCARTheme.textFont(size: 15, weight: .semibold))
                            TextField("Sunday Pit Crew", text: $leagueName)
                                .textFieldStyle(.plain)
                                .focused($focusedField, equals: .leagueName)
                                .appInputField()

                            Stepper("Season Year: \(String(seasonYear))", value: $seasonYear, in: 2020...2100)

                            Text("Invite Code")
                                .font(NASCARTheme.textFont(size: 15, weight: .semibold))
                            TextField("RACER-2026", text: $newInviteCode)
                                .textInputAutocapitalization(.characters)
                                .textFieldStyle(.plain)
                                .focused($focusedField, equals: .newInviteCode)
                                .appInputField()

                            Text("Payout Notes (Optional)")
                                .font(NASCARTheme.textFont(size: 15, weight: .semibold))
                            TextEditor(text: $payoutConfigText)
                                .frame(minHeight: 88)
                                .padding(.horizontal, 8)
                                .padding(.vertical, 8)
                                .background(NASCARTheme.fieldBackground(for: colorScheme))
                                .overlay(
                                    RoundedRectangle(cornerRadius: 12, style: .continuous)
                                        .stroke(NASCARTheme.border(for: colorScheme), lineWidth: 1)
                                )
                                .clipShape(RoundedRectangle(cornerRadius: 12, style: .continuous))
                                .focused($focusedField, equals: .payoutNotes)
                        }

                        Button("Create League") {
                            focusedField = nil
                            viewModel.clearMessages()
                            viewModel.createLeague(
                                name: leagueName,
                                seasonYear: seasonYear,
                                inviteCode: newInviteCode.uppercased(),
                                payoutConfigText: payoutConfigText
                            )
                        }
                        .buttonStyle(BrandPrimaryButtonStyle())
                        .disabled(!canCreate || viewModel.isLoading)
                    }
                    .appCard()

                    if let statusMessage = viewModel.statusMessage {
                        Text(statusMessage)
                            .font(NASCARTheme.textFont(size: 13, weight: .semibold))
                            .foregroundStyle(.green)
                            .frame(maxWidth: .infinity, alignment: .leading)
                            .appCard(padding: 14)
                    }

                    Button("Sign Out") {
                        try? sessionStore.signOut()
                    }
                    .buttonStyle(BrandSecondaryButtonStyle())
                }
                .frame(maxWidth: 700)
                .padding(.horizontal, 16)
                .padding(.top, 12)
                .padding(.bottom, 22)
            }
            .appScreenBackground()
            .navigationTitle("League Setup")
            .onTapGesture {
                focusedField = nil
            }
        }
    }
}
