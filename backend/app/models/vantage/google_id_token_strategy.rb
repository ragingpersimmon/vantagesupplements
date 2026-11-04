require 'net/http'

module Vantage
  # Spree Store API login provider for Google Identity Services (One Tap and the
  # "Sign in with Google" button).
  #
  # The browser receives a Google-signed ID token (JWT) and the storefront posts it to
  #
  #   POST /api/v3/store/auth/login  { "provider": "google", "id_token": "<jwt>" }
  #
  # This strategy verifies the token against Google's published keys, then resolves
  # it to a Spree customer:
  #
  #   1. a known Google identity (UserIdentity provider=google, uid=sub) logs in;
  #   2. an existing customer with the same email adopts the identity, but only if
  #      Google asserts email_verified — otherwise anyone could claim any account;
  #   3. otherwise a new customer is created.
  #
  # Spree then issues its own access JWT + refresh token, so the storefront keeps a
  # single session system (the Spree one) rather than running NextAuth alongside it.
  class GoogleIdTokenStrategy < Spree::Authentication::Strategies::BaseStrategy
    GOOGLE_ISSUERS = %w[accounts.google.com https://accounts.google.com].freeze
    GOOGLE_JWKS_URI = 'https://www.googleapis.com/oauth2/v3/certs'.freeze
    JWKS_CACHE_KEY = 'vantage/google/jwks'.freeze
    OPEN_TIMEOUT = 2
    READ_TIMEOUT = 5

    def provider
      'google'
    end

    def authenticate
      id_token = params[:id_token].presence || params[:credential].presence
      return failure('Google credential is required') if id_token.blank?

      client_id = ENV.fetch('GOOGLE_CLIENT_ID', nil)
      return failure('Google sign-in is not configured') if client_id.blank?

      claims = verify(id_token, client_id)
      return failure('Google account email is not verified') unless claims['email_verified'].to_s == 'true'

      success(resolve_user(claims))
    rescue JWT::DecodeError => e
      Rails.logger.warn("[Vantage] Google ID token rejected: #{e.class}: #{e.message}")
      failure('Invalid Google credential')
    rescue StandardError => e
      Rails.logger.error("[Vantage] Google sign-in failed: #{e.class}: #{e.message}")
      failure('Google sign-in failed')
    end

    private

    # Signature, issuer, audience and expiry are all enforced. Skipping audience
    # would let a token minted for some other site's Google client log in here.
    def verify(id_token, client_id)
      claims, = JWT.decode(
        id_token, nil, true,
        algorithms: ['RS256'],
        iss: GOOGLE_ISSUERS, verify_iss: true,
        aud: client_id, verify_aud: true,
        verify_expiration: true,
        jwks: jwks_loader
      )
      claims
    end

    def resolve_user(claims)
      uid = claims.fetch('sub')
      info = {
        email: claims['email'],
        first_name: claims['given_name'],
        last_name: claims['family_name'],
        name: claims['name'],
        picture: claims['picture']
      }

      identity = Spree::UserIdentity.find_by(provider: provider, uid: uid, user_type: user_class.name)
      return identity.user if identity

      existing = find_user_by_email(claims['email'])
      if existing
        existing.identities.create!(provider: provider, uid: uid, info: info)
        return existing
      end

      # Creates the customer + identity in one transaction; handles the
      # double-submit race via RecordNotUnique internally.
      find_or_create_user_from_oauth(provider: provider, uid: uid, info: info)
    end

    # Loader proc: the jwt gem re-invokes it with invalidate: true when a token's
    # `kid` is missing, so Google key rotation is picked up without a restart.
    def jwks_loader
      lambda do |options|
        Rails.cache.delete(JWKS_CACHE_KEY) if options[:invalidate]
        JWT::JWK::Set.new(
          Rails.cache.fetch(JWKS_CACHE_KEY, expires_in: 6.hours) { JSON.parse(http_get(GOOGLE_JWKS_URI)) }
        )
      end
    end

    def http_get(url)
      uri = URI(url)
      http = Net::HTTP.new(uri.host, uri.port)
      http.use_ssl = true
      http.open_timeout = OPEN_TIMEOUT
      http.read_timeout = READ_TIMEOUT
      response = http.request(Net::HTTP::Get.new(uri))
      raise "#{url} returned #{response.code}" unless response.is_a?(Net::HTTPSuccess)

      response.body
    end
  end
end
