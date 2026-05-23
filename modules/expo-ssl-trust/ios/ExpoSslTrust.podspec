require 'json'

package = JSON.parse(File.read(File.join(__dir__, '..', 'package.json')))

Pod::Spec.new do |s|
  s.name           = 'ExpoSslTrust'
  s.version        = package['version']
  s.summary        = 'Expo module for self-signed SSL certificate trust management'
  s.description    = 'Provides TOFU (Trust On First Use) SSL certificate management for React Native apps'
  s.author         = 'Gaven Henry'
  s.homepage       = 'https://github.com/substreamer'
  s.platforms      = { :ios => '16.4' }
  s.source         = { git: 'https://github.com/substreamer/substreamer-rn.git', tag: s.version.to_s }
  s.static_framework = true
  s.license        = { :type => 'MIT' }

  s.dependency 'ExpoModulesCore'

  s.source_files = '**/*.swift'
end
