const path = require("path");

const action = process.argv[2]; // --install or --uninstall

if (!["--install", "--uninstall"].includes(action)) {
  console.log("Usage: node windows-service.js --install | --uninstall");
  process.exit(1);
}

try {
  const Service = require("node-windows").Service;

  const svc = new Service({
    name: "Pako Fiscal Bridge",
    description: "Local bridge service for PAKO fiscal printer communication",
    script: path.join(__dirname, "..", "index.js"),
    nodeOptions: [],
    env: [
      {
        name: "NODE_ENV",
        value: "production",
      },
    ],
  });

  if (action === "--install") {
    svc.on("install", () => {
      svc.start();
      console.log("Service installed and started.");
    });
    svc.on("alreadyinstalled", () => {
      console.log("Service is already installed.");
    });
    svc.install();
  } else {
    svc.on("uninstall", () => {
      console.log("Service uninstalled.");
    });
    svc.uninstall();
  }
} catch (err) {
  console.error("Error:", err.message);
  console.log("Note: node-windows only works on Windows.");
  process.exit(1);
}
