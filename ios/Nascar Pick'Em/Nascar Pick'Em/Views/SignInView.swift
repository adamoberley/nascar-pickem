import SwiftUI

struct NASCARStripingView: View {
    let width: CGFloat
    let height: CGFloat
    
    var body: some View {
        let x = width / 11.2 // Base unit
        // Pattern: Yellow (1) → clear (0.5) → yellow (1) → clear (1) → red (1.6) → clear (0.5) → red (1.6) → clear (1) → blue (3)
        
        HStack(spacing: 0) {
            // Yellow stripe 1 (1x)
            Rectangle()
                .fill(NASCARTheme.yellow)
                .frame(width: x * 1.0)
            // Clear space 1 (0.5x)
            Rectangle()
                .fill(Color.clear)
                .frame(width: x * 0.5)
            // Yellow stripe 2 (1x)
            Rectangle()
                .fill(NASCARTheme.yellow)
                .frame(width: x * 1.0)
            // Clear space 2 (1x)
            Rectangle()
                .fill(Color.clear)
                .frame(width: x * 1.0)
            // Red stripe 1 (1.6x)
            Rectangle()
                .fill(NASCARTheme.red)
                .frame(width: x * 1.6)
            // Clear space 3 (0.5x)
            Rectangle()
                .fill(Color.clear)
                .frame(width: x * 0.5)
            // Red stripe 2 (1.6x)
            Rectangle()
                .fill(NASCARTheme.red)
                .frame(width: x * 1.6)
            // Clear space 4 (1x)
            Rectangle()
                .fill(Color.clear)
                .frame(width: x * 1.0)
            // Blue block (3x)
            Rectangle()
                .fill(NASCARTheme.blue)
                .frame(width: x * 3.0)
        }
        .frame(width: width, height: height)
    }
}

struct SignInView: View {
    @EnvironmentObject private var sessionStore: SessionStore
    @Environment(\.colorScheme) private var colorScheme

    private enum AuthMode: String, CaseIterable {
        case signIn = "Sign In"
        case signUp = "Create Account"

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
                .opacity(colorScheme == .dark ? 0.18 : 0.1)
                .ignoresSafeArea()
            NASCARTheme.screenGradient(for: colorScheme)
                .ignoresSafeArea()

            VStack(spacing: 0) {
                Spacer()
                
                VStack(spacing: 24) {
                    // Centered logo section
                    VStack(spacing: 16) {
                        NASCARStripingView(width: 250, height: 4)
                            .accessibilityHidden(true)
                        
                        Text("NASCAR PICK'EM")
                            .font(NASCARTheme.displayFont(size: 34, weight: .heavy))
                            .textCase(.uppercase)
                    }

                    // Floating form card
                    VStack(alignment: .leading, spacing: 24) {
                        VStack(alignment: .leading, spacing: 16) {
                            Text("Email")
                                .font(NASCARTheme.textFont(size: 15, weight: .semibold))
                            TextField("you@example.com", text: $email)
                                .keyboardType(.emailAddress)
                                .textInputAutocapitalization(.never)
                                .textContentType(.emailAddress)
                                .autocorrectionDisabled(true)
                                .textFieldStyle(.plain)
                                .submitLabel(.next)
                                .focused($focusedField, equals: .email)
                                .onSubmit {
                                    focusedField = .password
                                }
                                .appInputField()

                            Text("Password")
                                .font(NASCARTheme.textFont(size: 15, weight: .semibold))
                            SecureField(
                                authMode == .signUp ? "At least 6 characters" : "Your password",
                                text: $password
                            )
                            .textInputAutocapitalization(.never)
                            .textContentType(authMode == .signUp ? .newPassword : .password)
                            .autocorrectionDisabled(true)
                            .textFieldStyle(.plain)
                            .submitLabel(.go)
                            .focused($focusedField, equals: .password)
                            .onSubmit {
                                submit()
                            }
                            .appInputField()
                        }

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
                                }
                                Spacer()
                            }
                        }
                        .buttonStyle(BrandPrimaryButtonStyle())
                        .disabled(isBusy)

                        Button(authMode == .signIn ? "Need an account? Create one" : "Already have an account? Sign in") {
                            authMode = authMode == .signIn ? .signUp : .signIn
                        }
                        .buttonStyle(BrandSecondaryButtonStyle())
                        .disabled(isBusy)
                        .padding(.top, 4)

                        if let errorMessage {
                            Text(errorMessage)
                                .font(NASCARTheme.textFont(size: 13))
                                .foregroundStyle(NASCARTheme.red)
                                .multilineTextAlignment(.leading)
                        }

                        if !infoMessage.isEmpty {
                            Text(infoMessage)
                                .font(NASCARTheme.textFont(size: 13))
                                .foregroundStyle(.green)
                                .multilineTextAlignment(.leading)
                        }
                    }
                    .padding(.horizontal, 32)
                    .padding(.vertical, 20)
                    .background {
                        RoundedRectangle(cornerRadius: 20)
                            .fill(Color.clear)
                    }
                }
                .frame(maxWidth: 440)
                .frame(maxWidth: .infinity)
                .padding(.horizontal, 20)
                
                Spacer()
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
