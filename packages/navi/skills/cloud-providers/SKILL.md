---
name: cloud-providers
description: "Authoritative reference, architecture patterns, and documentation for major cloud providers: AWS, Oracle Cloud (OCI), Google Cloud (GCP), Cloudflare, and Microsoft Azure. Use when designing, building, deploying, configuring, or troubleshooting cloud services, infrastructure as code (IaC), serverless apps, and containerized deployments."
---

# Cloud Providers & Official Documentation

When developing, configuring, or deploying applications to cloud infrastructure, agents MUST leverage the official documentation portals and GitHub repositories for accurate SDK usage, CLI commands, architecture patterns, and configuration schemas.

---

## Quick Reference Index

| Provider | Official Documentation Website | Official GitHub Repositories | CLI & Infrastructure Tools |
| :--- | :--- | :--- | :--- |
| **Amazon Web Services (AWS)** | [docs.aws.amazon.com](https://docs.aws.amazon.com/) | [github.com/awsdocs](https://github.com/awsdocs) | AWS CLI (`aws`), AWS CDK, SAM, CloudFormation |
| **Oracle Cloud Infrastructure (OCI)** | [docs.oracle.com](https://docs.oracle.com/)<br>• [Cloud Portal](https://docs.oracle.com/en/cloud/)<br>• [OCI Docs](https://docs.oracle.com/en-us/iaas/Content/home.htm) | [github.com/oracle](https://github.com/oracle)<br>[github.com/oracle-devrel](https://github.com/oracle-devrel) | OCI CLI (`oci`), OCI Terraform Provider, OCI SDKs |
| **Google Cloud Platform (GCP)** | [docs.cloud.google.com](https://docs.cloud.google.com/docs)<br>[cloud.google.com/docs](https://cloud.google.com/docs) | [github.com/googlecloudplatform](https://github.com/googlecloudplatform) | Google Cloud CLI (`gcloud`), Terraform GCP Provider |
| **Cloudflare** | [developers.cloudflare.com](https://developers.cloudflare.com/) | [github.com/cloudflare](https://github.com/cloudflare) | Wrangler (`wrangler`), Cloudflare Terraform, REST API |
| **Microsoft Azure** | [learn.microsoft.com/azure](https://learn.microsoft.com/en-us/azure/?product=popular) | [github.com/MicrosoftDocs](https://github.com/MicrosoftDocs)<br>[azure-docs](https://github.com/MicrosoftDocs/azure-docs) | Azure CLI (`az`), Azure Bicep, ARM Templates |

---

## 1. Amazon Web Services (AWS)

- **Documentation**: [https://docs.aws.amazon.com/](https://docs.aws.amazon.com/)
- **GitHub**: [https://github.com/awsdocs](https://github.com/awsdocs)
- **Key Services**:
  - **Serverless & Compute**: AWS Lambda, Amazon ECS (Fargate), Amazon EKS, Amazon EC2.
  - **Storage**: Amazon S3, Amazon EBS, Amazon EFS.
  - **Databases**: Amazon DynamoDB, Amazon RDS, Amazon Aurora, Amazon ElastiCache.
  - **Networking & Delivery**: Amazon CloudFront, Amazon Route 53, Amazon VPC, API Gateway.
  - **Identity & Security**: AWS IAM, AWS Secrets Manager, AWS KMS, AWS WAF.
- **Workflow**:
  - Inspect official SDK examples in `https://github.com/awsdocs` (e.g., `aws-doc-sdk-examples`).
  - Use infrastructure as code: AWS CDK or Terraform AWS Provider.
  - Never commit AWS credentials; rely on IAM roles, environment variables, or AWS credential files.

---

## 2. Oracle Cloud Infrastructure (OCI)

- **Documentation**: [https://docs.oracle.com/](https://docs.oracle.com/)
  - Cloud Directory: [https://docs.oracle.com/en/cloud/](https://docs.oracle.com/en/cloud/)
  - IaaS / OCI User Guide: [https://docs.oracle.com/en-us/iaas/Content/home.htm](https://docs.oracle.com/en-us/iaas/Content/home.htm)
- **GitHub**:
  - Main: [https://github.com/oracle](https://github.com/oracle)
  - Developer Relations: [https://github.com/oracle-devrel](https://github.com/oracle-devrel)
- **Key Services**:
  - **Compute & Containers**: OCI Compute Shapes, Container Engine for Kubernetes (OKE), OCI Functions.
  - **Databases**: Autonomous Database (ATP, ADW), Exadata, MySQL Database Service with HeatWave.
  - **Storage & Networking**: OCI Object Storage, Block Volumes, Virtual Cloud Network (VCN), Load Balancers.
  - **Security**: OCI IAM, Vault, Cloud Guard.
- **Workflow**:
  - Consult `oracle-devrel` repositories for battle-tested deployment architectures, Terraform modules, and cloud-native guides.
  - Use `oci` CLI or Terraform OCI Provider for provisioning.

---

## 3. Google Cloud Platform (GCP)

- **Documentation**: [https://docs.cloud.google.com/docs](https://docs.cloud.google.com/docs) & [https://cloud.google.com/docs](https://cloud.google.com/docs)
- **GitHub**: [https://github.com/googlecloudplatform](https://github.com/googlecloudplatform)
- **Key Services**:
  - **Compute & Serverless**: Cloud Run (recommended for containerized services), Google Kubernetes Engine (GKE), Compute Engine, Cloud Functions.
  - **Storage & Data**: Cloud Storage (GCS), Cloud SQL, Cloud Spanner, Firestore, BigQuery.
  - **Networking**: Cloud CDN, Cloud DNS, Cloud Load Balancing, VPC.
  - **Security & Ops**: Cloud IAM, Secret Manager, Cloud KMS, Cloud Logging & Monitoring.
- **Workflow**:
  - Check `googlecloudplatform` on GitHub for reference architectures, community Terraform modules, and official quickstarts.
  - Prefer Google Cloud Run for containerized web apps; manage with `gcloud run deploy`.

---

## 4. Cloudflare

- **Documentation**: [https://developers.cloudflare.com/](https://developers.cloudflare.com/)
- **GitHub**: [https://github.com/cloudflare](https://github.com/cloudflare)
- **Key Services**:
  - **Compute**: Cloudflare Workers, Pages (Full-stack Jamstack hosting).
  - **Storage & Databases**: Cloudflare D1 (Serverless SQLite), KV (Key-Value), R2 (S3-compatible zero egress storage), Hyperdrive (Database connection accelerator), Vectorize (Vector DB).
  - **Messaging**: Cloudflare Queues, Workflows.
  - **Network & Security**: DNS, DDoS Protection, Web Application Firewall (WAF), Zero Trust.
- **Workflow**:
  - Manage worker applications and configuration via `wrangler.toml` or `wrangler.jsonc`.
  - Use `wrangler dev` for local simulation and `wrangler deploy` to ship.
  - Read `https://developers.cloudflare.com/` for current binding formats and API runtimes.

---

## 5. Microsoft Azure

- **Documentation**: [https://learn.microsoft.com/en-us/azure/?product=popular](https://learn.microsoft.com/en-us/azure/?product=popular)
- **GitHub**: [https://github.com/MicrosoftDocs](https://github.com/MicrosoftDocs) (specifically [azure-docs](https://github.com/MicrosoftDocs/azure-docs))
- **Key Services**:
  - **Compute**: Azure App Service, Azure Functions, Azure Container Apps, Azure Kubernetes Service (AKS).
  - **Databases**: Azure Cosmos DB, Azure SQL Database, Azure Database for PostgreSQL.
  - **Storage**: Azure Blob Storage, Azure Files.
  - **Networking & CDN**: Azure Virtual Network, Azure Front Door, Azure Application Gateway.
  - **Identity & Security**: Microsoft Entra ID (Azure AD), Azure Key Vault, Defender for Cloud.
- **Workflow**:
  - Review `azure-docs` and `MicrosoftDocs` for deployment templates (Bicep/ARM).
  - Automate using Azure CLI (`az`) or GitHub Actions (`azure/login`, `azure/webapps-deploy`).

---

## Agent Usage Guidelines

When any Navi agent (such as `scout`, `architect`, `build`, or `general`) is asked to design, configure, or troubleshoot cloud infrastructure:
1. **Identify the Target Cloud Provider**: Detect whether the project targets AWS, OCI, GCP, Cloudflare, or Azure.
2. **Access Authoritative Sources**:
   - For architecture design: check the provider's official documentation website.
   - For code, SDKs, and templates: use `scout` or search tools against the provider's official GitHub organization.
3. **Never Guess API Signatures or Config Formats**: Always verify SDK parameter names, IAM policy schemas, and configuration structures against the official provider docs.
