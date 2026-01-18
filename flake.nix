{
  description = "navi development flake";

  inputs = {
    nixpkgs.url = "github:NixOS/nixpkgs/nixpkgs-unstable";
  };

  outputs =
    {
      nixpkgs,
      ...
    }:
    let
      systems = [
        "aarch64-linux"
        "x86_64-linux"
        "aarch64-darwin"
        "x86_64-darwin"
      ];
      inherit (nixpkgs) lib;
      forEachSystem = lib.genAttrs systems;
      pkgsFor = system: nixpkgs.legacyPackages.${system};
      packageJson = builtins.fromJSON (builtins.readFile ./packages/navi/package.json);
      bunTarget = {
        "aarch64-linux" = "bun-linux-arm64";
        "x86_64-linux" = "bun-linux-x64";
        "aarch64-darwin" = "bun-darwin-arm64";
        "x86_64-darwin" = "bun-darwin-x64";
      };

      # Parse "bun-{os}-{cpu}" to {os, cpu}
      parseBunTarget =
        target:
        let
          parts = lib.splitString "-" target;
        in
        {
          os = builtins.elemAt parts 1;
          cpu = builtins.elemAt parts 2;
        };

      hashesFile = "${./nix}/hashes.json";
      hashesData =
        if builtins.pathExists hashesFile then builtins.fromJSON (builtins.readFile hashesFile) else { };
      # Lookup hash: supports per-system ({system: hash}) or legacy single hash
      nodeModulesHashFor =
        system:
        if builtins.isAttrs hashesData.nodeModules then
          hashesData.nodeModules.${system}
        else
          hashesData.nodeModules;
      modelsDev = forEachSystem (
        system:
        let
          pkgs = pkgsFor system;
        in
        pkgs."models-dev"
      );
    in
    {
      devShells = forEachSystem (
        system:
        let
          pkgs = pkgsFor system;
        in
        {
          default = pkgs.mkShell {
            packages = with pkgs; [
              bun
              nodejs_20
              pkg-config
              openssl
              git
            ];
          };
        }
      );

      packages = forEachSystem (
        system:
        let
          pkgs = pkgsFor system;
          bunPlatform = parseBunTarget bunTarget.${system};
          mkNodeModules = pkgs.callPackage ./nix/node-modules.nix {
            hash = nodeModulesHashFor system;
            bunCpu = bunPlatform.cpu;
            bunOs = bunPlatform.os;
          };
          mknavi = pkgs.callPackage ./nix/navi.nix { };
          mkDesktop = pkgs.callPackage ./nix/desktop.nix { };

          naviPkg = mknavi {
            inherit (packageJson) version;
            src = ./.;
            scripts = ./nix/scripts;
            target = bunTarget.${system};
            modelsDev = "${modelsDev.${system}}/dist/_api.json";
            inherit mkNodeModules;
          };

          desktopPkg = mkDesktop {
            inherit (packageJson) version;
            src = ./.;
            scripts = ./nix/scripts;
            mkNodeModules = mkNodeModules;
            navi = naviPkg;
          };
        in
        {
          default = naviPkg;
          desktop = desktopPkg;
        }
      );

      apps = forEachSystem (
        system:
        let
          pkgs = pkgsFor system;
        in
        {
          navi-dev = {
            type = "app";
            meta = {
              description = "Nix devshell shell for navi";
              runtimeInputs = [ pkgs.bun ];
            };
            program = "${
              pkgs.writeShellApplication {
                name = "navi-dev";
                text = ''
                  exec bun run dev "$@"
                '';
              }
            }/bin/navi-dev";
          };
        }
      );
    };
}
