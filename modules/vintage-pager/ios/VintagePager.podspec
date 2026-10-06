Pod::Spec.new do |s|
  s.name           = 'VintagePager'
  s.version        = '1.0.0'
  s.summary        = 'Keeps the tab pager to one finger.'
  s.description    = 'Local Expo module. The pager behind the tabs is told that a pan takes one finger, so a pinch on a photograph or the timeline never swipes the tabs.'
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
