# Vesti UI Refactor Spec Package (v1.4)

Status: Opened for v1.4 planning and implementation.
Owner: Frontend + UI Design + QA

## Files

- `v1_4_information_architecture_contract.md`
  - v1.4 信息架构总契约（四分区边界、中心动作、命名与路由策略）
- `v1_4_settings_information_density_contract.md`
  - v1.4 Settings 信息密度契约（三分组、Support 平铺、说明文案分级）
- `v1_4_ui_refactor_engineering_spec.md`
  - v1.4 主规格（范围、架构、信息结构、实施里程碑）
- `v1_4_ui_refactor_component_system_spec.md`
  - 组件系统与视觉 token 合同（组件层级、状态、可访问性）
- `ui_refactor_debugging_playbook.md`
  - UI 重构调试与回归流程（开发/QA 共用）
- `ui_refactor_manual_sampling_and_acceptance.md`
  - 手测采样矩阵、交付证据标准、Go/No-Go 门禁

## Version policy

- v1.3 is closed.
- v1.4 is reserved for global UI refactor.
- v1.5 is reserved for floating capsule upgrade (`documents/floating_capsule/*`).
- Cross-version dependencies must reference `documents/capture_engine/*`.
- IA decisions in v1.4 must use `v1_4_information_architecture_contract.md` as source of truth.
- Settings density/support semantics in v1.4 must use `v1_4_settings_information_density_contract.md` as source of truth.
- Extension sans fonts are local-only (`frontend/public/fonts/*`), built via `scripts/build-ui-fonts.ps1`.
