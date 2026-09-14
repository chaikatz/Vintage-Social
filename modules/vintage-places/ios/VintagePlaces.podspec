Pod::Spec.new do |s|
  s.name           = 'VintagePlaces'
  s.version        = '1.0.0'
  s.summary        = 'Searches Apple Maps for the place a post names.'
  s.description    = 'Local Expo module. MKLocalSearch over the query a member types, returning named places with enough address to tell them apart.'
  s.author         = 'VINTAGE'
  s.homepage       = 'https://github.com/chaikatz/Vintage-Social'
  s.license        = { :type => 'MIT' }
  s.platforms      = { :ios => '15.1' }
  s.swift_version  = '5.9'
  s.source         = { git: '' }
  s.static_framework = true

  s.dependency 'ExpoModulesCore'

  s.pod_target_xcconfig = {
    'DEFINES_MODULE' => 'YES',
    'SWIFT_COMPILATION_MODE' => 'wholemodule'
  }

  s.source_files = "**/*.{h,m,swift}"
end
