# 제출 시나리오의 YAML 구문·문자열 타입·ID와 실제 검사 파일의 대응을 확인한다.
# Ruby 표준 YAML만 사용한다. 앱 실행·AI 요청은 하지 않는다.
require 'yaml'
require 'set'

root = File.expand_path('..', __dir__)
path = ARGV[0] || File.join(root, 'docs/scenarios.yaml')
begin
  doc = YAML.safe_load(File.read(path), aliases: false)
  raise '문서 최상위는 mapping이어야 합니다' unless doc.is_a?(Hash)
  raise 'platform은 desktop/mobile/both여야 합니다' unless %w[desktop mobile both].include?(doc['platform'])
  text = ->(value) { value.is_a?(String) && !value.strip.empty? }
  raise 'platformReason은 빈 문자열이 아니어야 합니다' unless text.call(doc['platformReason'])
  scenarios = doc['scenarios']
  raise 'scenarios는 3~8개 목록이어야 합니다' unless scenarios.is_a?(Array) && (3..8).cover?(scenarios.size)
  ids = []
  scenarios.each do |scenario|
    raise '시나리오는 mapping이어야 합니다' unless scenario.is_a?(Hash)
    id = scenario['id']
    raise 'id는 S1 같은 형식이어야 합니다' unless id.is_a?(String) && id.match?(/\AS[1-9]\d*\z/)
    raise "#{id}: 중복 ID" if ids.include?(id)
    ids << id
    %w[title expected].each { |key| raise "#{id}.#{key}: 빈 문자열이 아니어야 합니다" unless text.call(scenario[key]) }
    steps = scenario['steps']
    raise "#{id}.steps: 1~12개 목록이어야 합니다" unless steps.is_a?(Array) && (1..12).cover?(steps.size)
    steps.each_with_index { |step, i| raise "#{id}.steps[#{i}]: 빈 문자열이 아니어야 합니다 (따옴표·콜론 확인)" unless text.call(step) }
  end
  specs = Dir.glob(File.join(root, 'e2e/scenarios/S*.spec.ts')).map { |file| File.basename(file, '.spec.ts') }.select { |id| id.match?(/\AS[1-9]\d*\z/) }
  raise "YAML과 E2E ID 불일치: YAML만 #{ids - specs}, E2E만 #{specs - ids}" unless ids.to_set == specs.to_set
  puts "Scenario YAML valid: #{ids.join(', ')} (#{ids.size} scenarios)"
rescue Psych::Exception, StandardError => e
  warn "Scenario YAML validation failed: #{e.message}"
  exit 1
end
