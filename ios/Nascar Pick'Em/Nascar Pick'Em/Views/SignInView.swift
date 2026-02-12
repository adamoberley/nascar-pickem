import SwiftUI

struct SignInView: View {
    @EnvironmentObject private var sessionStore: SessionStore

    private enum AuthMode: String, CaseIterable {
        case signIn = "Sign In"
        case signUp = "Create Account"

        var helperText: String {
            switch self {
            case .signIn:
                return "Use your email and password to get back to your league."
            case .signUp:
                return "Create a new account to join your NASCAR Pick'Em league."
            }
        }

        var submitTitle: String {
            switch self {
            case .signIn:
                return "Sign In"
            case .signUp:
                return "Create Account"
            }
        }
    }

    private enum Field {
        case email
        case password
    }

    @State private var email = ""
    @State private var password = ""
    @State private var authMode: AuthMode = .signIn
    @State private var infoMessage = ""
    @State private var errorMessage: String?
    @State private var isBusy = false
    @FocusState private var focusedField: Field?

    var body: some View {
        ZStack {
            Image("CheckeredFlag")
                .resizable()
                .aspectRatio(contentMode: .fill)
                .ignoresSafeArea()
            LinearGradient(
                colors: [Color.black.opacity(0.72), Color.black.opacity(0.55)],
                startPoint: .topLeading,
                endPoint: .bottomTrailing
            )
                .ignoresSafeArea()

            ScrollView {
                VStack(spacing: 22) {
                    VStack(spacing: 8) {
                        Text("NASCAR")
                            .font(.system(size: 42, weight: .black, design: .rounded))
                            .foregroundStyle(.white)
                        Text("Pick'Em")
                            .font(.system(size: 30, weight: .bold, design: .rounded))
                            .foregroundStyle(.white.opacity(0.96))
                    }

                    VStack(alignment: .leading, spacing: 16) {
                        Picker("Account", selection: $authMode) {
                            ForEach(AuthMode.allCases, id: \.self) { mode in
                                Text(mode.rawValue).tag(mode)
                            }
                        }
                        .pickerStyle(.segmented)
                        .disabled(isBusy)

                        Text(authMode.helperText)
                            .font(.subheadline)
                            .foregroundStyle(.white.opacity(0.85))

                        VStack(alignment: .leading, spacing: 10) {
                            Text("Email")
                                .font(.subheadline.weight(.semibold))
                                .foregroundStyle(.white.opacity(0.9))
                            TextField("you@example.com", text: $email)
                                .keyboardType(.emailAddress)
                                .textInputAutocapitalization(.never)
                                .textContentType(.emailAddress)
                                .autocorrectionDisabled(true)
                                .submitLabel(.next)
                                .focused($focusedField, equals: .email)
                                .onSubmit {
                                    focusedField = .password
                                }

                            Text("Password")
                                .font(.subheadline.weight(.semibold))
                                .foregroundStyle(.white.opacity(0.9))
                            SecureField(
                                authMode == .signUp ? "At least 6 characters" : "Your password",
                                text: $password
                            )
                            .textInputAutocapitalization(.never)
                            .textContentType(authMode == .signUp ? .newPassword : .password)
                            .autocorrectionDisabled(true)
                            .submitLabel(.go)
                            .focused($focusedField, equals: .password)
                            .onSubmit {
                                submit()
                            }
                        }
                        .padding(14)
                        .background(Color.white.opacity(0.1))
                        .clipShape(RoundedRectangle(cornerRadius: 14, style: .continuous))

                        Button {
                            submit()
                        } label: {
                            HStack {
                                Spacer()
                                if isBusy {
                                    ProgressView()
                                        .progressViewStyle(CircularProgressViewStyle(tint: .white))
                                } else {
                                    Text(authMode.submitTitle)
                                        .fontWeight(.bold)
                                }
                                Spacer()
                            }
                            .padding(.vertical, 14)
                            .background(
                                LinearGradient(
                                    colors: [Color(red: 0.82, green: 0.13, blue: 0.2), Color(red: 0.0, green: 0.38, blue: 0.72)],
                                    startPoint: .leading,
                                    endPoint: .trailing
                                )
                            )
                            .clipShape(RoundedRectangle(cornerRadius: 14, style: .continuous))
                        }
                        .buttonStyle(.plain)
                        .disabled(isBusy)

                        if let errorMessage {
                            Text(errorMessage)
                                .font(.footnote)
                                .foregroundStyle(Color.red.opacity(0.95))
                                .multilineTextAlignment(.leading)
                        }

                        if !infoMessage.isEmpty {
                            Text(infoMessage)
                                .font(.footnote)
                                .foregroundStyle(Color.green.opacity(0.95))
                                .multilineTextAlignment(.leading)
                        }
                    }
                    .padding(20)
                    .background(Color.black.opacity(0.45))
                    .clipShape(RoundedRectangle(cornerRadius: 22, style: .continuous))
                    .overlay(
                        RoundedRectangle(cornerRadius: 22, style: .continuous)
                            .stroke(Color.white.opacity(0.2), lineWidth: 1)
                    )
                }
                .frame(maxWidth: 440)
                .padding(.horizontal, 20)
                .padding(.top, 48)
                .padding(.bottom, 36)
            }
            .scrollDismissesKeyboard(.interactively)
        }
        .onTapGesture {
            focusedField = nil
        }
    }

    private func submit() {
        let trimmedEmail = email.trimmingCharacters(in: .whitespacesAndNewlines)

        guard !trimmedEmail.isEmpty, !password.isEmpty else {
            errorMessage = "Please enter email and password."
            return
        }
        guard authMode == .signIn || password.count >= 6 else {
            errorMessage = "Password must be at least 6 characters."
            return
        }

        focusedField = nil
        errorMessage = nil
        infoMessage = ""
        isBusy = true
        let mode = authMode

        let completion: (Result<Void, Error>) -> Void = { result in
            DispatchQueue.main.async {
                isBusy = false
                switch result {
                case .success:
                    errorMessage = nil
                    infoMessage = mode == .signUp ? "Account created. You are now signed in." : ""
                case .failure(let error):
                    infoMessage = ""
                    errorMessage = error.localizedDescription
                }
            }
        }

        if mode == .signUp {
            sessionStore.signUp(email: trimmedEmail, password: password, completion: completion)
        } else {
            sessionStore.signInWithPassword(email: trimmedEmail, password: password, completion: completion)
        }
    }
}

#Preview {
    SignInView()
        .environmentObject(SessionStore())
}
