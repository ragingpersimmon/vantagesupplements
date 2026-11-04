# Vantage Supplements customizations to the stock Spree image.
#
# Registers the "google" Store API login provider. Must run after Spree's engine
# has built the default registries, hence after_initialize.
Rails.application.config.after_initialize do
  Spree.store_authentication_strategies.add(:google, Vantage::GoogleIdTokenStrategy)
end
