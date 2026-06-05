-- AlterTable
ALTER TABLE "organization_invitations" ADD COLUMN     "access_all_projects" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "project_ids" TEXT[] DEFAULT ARRAY[]::TEXT[];

-- AlterTable
ALTER TABLE "organization_members" ADD COLUMN     "access_all_projects" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "project_ids" TEXT[] DEFAULT ARRAY[]::TEXT[];
