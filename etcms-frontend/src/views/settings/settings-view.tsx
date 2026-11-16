import { useState, useRef, useEffect } from 'react';
import {
  Shield,
  Users,
  Server,
  Plus,
  Trash2,
  CheckCircle2,
  RefreshCw,
  Building2,
  AlertCircle,
  Sliders,
  Layers,
  Cpu,
  Database,
  HardDrive,
  Network,
  Radio,
  Workflow,
  Boxes,
  Cloud,
  Pencil,
  Search,
  Key,
  Globe,
  Activity,
  X,
  Check,
  GitFork,
  MoreHorizontal,
} from 'lucide-react';
import { useAuth, DEV_USERS, type DevUserOption } from '../../store/auth-context';
import { useToast } from '../../components/ui/toast';
import { Card, CardHeader, CardTitle, CardContent } from '../../components/ui/card';
import { Button } from '../../components/ui/button';
import { Badge } from '../../components/ui/badge';
import { Input } from '../../components/ui/input';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '../../components/ui/dialog';
import { cn } from '../../lib/utils';
import { useQueryClient } from '@tanstack/react-query';
import {
  useCustomRoles,
  useCreateCustomRole,
  useDeleteCustomRole,
  useAdminUsers,
  useCreateAdminUser,
  useUpdateUser,
  useDeleteUser,
  useResetUserPassword,
  useUserSessions,
  useRevokeSession,
  useOwnerGroups,
  useCreateOwnerGroup,
  useUpdateOwnerGroup,
  useDeleteOwnerGroup,
  useCIClasses,
  useCreateCIClass,
  useUpdateCIClass,
  useDeleteCIClass,
  DEFAULT_CI_CLASSES,
  useCategories,
  useCreateCategory,
  useUpdateCategory,
  useDeleteCategory,
  DEFAULT_CATEGORIES,
  type CategoryDefinition,
  useRelationshipTypes,
  useCreateRelationshipType,
  useUpdateRelationshipType,
  useDeleteRelationshipType,
  DEFAULT_RELATIONSHIP_TYPES,
  type RelationshipTypeDefinition,
  useCICatalog,
  type CustomRole,
  type OwnerGroup,
  type CIClassDefinition,
  type CIFormField,
  type AdminUserResponse,
} from '../../api/endpoints';
import { ConfirmDeleteDialog, type BlockingMetric } from '../../components/ui/confirm-dialog';

const CAPABILITY_DEFINITIONS = [
  { key: 'ci:read', label: 'View Catalog & Graph', category: 'Catalog & Topology', desc: 'Read access to CI catalog, search, and dependency graphs' },
  { key: 'ci:write', label: 'Create & Edit CIs', category: 'Catalog & Topology', desc: 'Create new configuration items and update operational metadata' },
  { key: 'edge:manage', label: 'Manage Dependency Edges', category: 'Catalog & Topology', desc: 'Create and disconnect direct dependency connections between CIs' },
  { key: 'ci:flag', label: 'Report & Resolve Flags', category: 'Governance', desc: 'Submit and resolve operational data-quality flags' },
  { key: 'ci:retire', label: 'Retire Configuration Items', category: 'Lifecycle', desc: 'Retire leaf CIs with no active dependent consumers' },
  { key: 'ci:force_retire', label: 'Force-Retire Override (Admin)', category: 'Lifecycle', desc: 'Administrative override to retire CIs even with dependent edges' },
  { key: 'audit:export', label: 'Stream & Export Audit Logs', category: 'Compliance', desc: 'Download immutable audit logs in CSV or NDJSON format' },
  { key: 'admin:all', label: 'Full Platform Administrator', category: 'System', desc: 'Unrestricted superuser access to all platform operations and settings' },
];

const COLOR_OPTIONS = [
  { value: 'cyan', label: 'Cyan', bg: 'bg-sky-50', text: 'text-sky-800', border: 'border-sky-200', dot: 'bg-sky-600' },
  { value: 'purple', label: 'Purple', bg: 'bg-purple-50', text: 'text-purple-800', border: 'border-purple-200', dot: 'bg-purple-600' },
  { value: 'emerald', label: 'Emerald', bg: 'bg-emerald-50', text: 'text-emerald-800', border: 'border-emerald-200', dot: 'bg-emerald-600' },
  { value: 'blue', label: 'Blue', bg: 'bg-blue-50', text: 'text-blue-800', border: 'border-blue-200', dot: 'bg-blue-600' },
  { value: 'indigo', label: 'Indigo', bg: 'bg-indigo-50', text: 'text-indigo-800', border: 'border-indigo-200', dot: 'bg-indigo-600' },
  { value: 'teal', label: 'Teal', bg: 'bg-teal-50', text: 'text-teal-800', border: 'border-teal-200', dot: 'bg-teal-600' },
  { value: 'slate', label: 'Slate', bg: 'bg-slate-50', text: 'text-slate-800', border: 'border-slate-200', dot: 'bg-slate-600' },
];

interface RowAction {
  label: string;
  icon?: React.ReactNode;
  onClick: () => void;
  variant?: 'default' | 'danger';
  disabled?: boolean;
  title?: string;
}

function RowActionsMenu({ actions }: { actions: RowAction[] }) {
  const [isOpen, setIsOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!isOpen) return;
    const handleClickOutside = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as any)) {
        setIsOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [isOpen]);

  return (
    <div className="relative inline-block text-left" ref={menuRef}>
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          setIsOpen((prev) => !prev);
        }}
        className="p-1 rounded text-secondary hover:text-primary hover:bg-hover transition-colors cursor-pointer"
        aria-label="Row actions"
        title="More actions"
      >
        <MoreHorizontal className="w-4 h-4" />
      </button>

      {isOpen && (
        <div
          className="absolute right-0 mt-1 w-40 bg-surface border border-hairline rounded-md shadow-lg py-1 z-30 animate-in fade-in-50 text-xs"
          onClick={(e) => e.stopPropagation()}
        >
          {actions.map((act, i) => (
            <button
              key={i}
              type="button"
              disabled={act.disabled}
              title={act.title}
              onClick={() => {
                setIsOpen(false);
                act.onClick();
              }}
              className={cn(
                "w-full text-left px-3 py-1.5 flex items-center gap-2 hover:bg-hover transition-colors cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed",
                act.variant === 'danger'
                  ? "text-tier0 hover:bg-tier0-bg font-medium"
                  : "text-secondary hover:text-primary"
              )}
            >
              {act.icon}
              <span>{act.label}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

export function SettingsView() {
  const { currentUser, activeOwnerGroup, switchDevUser, currentDevUserId } = useAuth();
  const toast = useToast();
  const queryClient = useQueryClient();

  const [activeTab, setActiveTab] = useState<'roles' | 'users' | 'administration' | 'system'>('administration');
  const [adminSection, setAdminSection] = useState<'classes' | 'categories' | 'relationships' | 'groups'>('classes');

  // Unified Confirm Delete Dialog state
  const [deleteConfirm, setDeleteConfirm] = useState<{
    open: boolean;
    title?: string;
    description?: string;
    itemName: string;
    itemType: string;
    isBlocked?: boolean;
    blockReason?: string;
    blockingMetrics?: BlockingMetric[];
    onConfirm: () => Promise<void>;
    isLoading?: boolean;
  }>({
    open: false,
    itemName: '',
    itemType: '',
    onConfirm: async () => {},
  });

  // Catalog CIs for referential integrity checking
  const { data: catalogData } = useCICatalog();
  const catalogCIs = catalogData?.items || [];

  // Custom Roles state
  const { data: customRoles = [], isLoading: rolesLoading } = useCustomRoles();
  const createRoleMutation = useCreateCustomRole();
  const deleteRoleMutation = useDeleteCustomRole();

  const [isRoleModalOpen, setIsRoleModalOpen] = useState(false);
  const [newRoleName, setNewRoleName] = useState('');
  const [newRoleDesc, setNewRoleDesc] = useState('');
  const [selectedPermissions, setSelectedPermissions] = useState<string[]>([]);
  const [roleFormError, setRoleFormError] = useState<string | null>(null);

  // Users state & mutations
  const { data: adminUsers = [], isLoading: usersLoading } = useAdminUsers();
  const createUserMutation = useCreateAdminUser();
  const updateUserMutation = useUpdateUser();
  const deleteUserMutation = useDeleteUser();
  const resetPasswordMutation = useResetUserPassword();

  // Sessions state & mutation
  const { data: userSessions = [], isLoading: sessionsLoading } = useUserSessions();
  const revokeSessionMutation = useRevokeSession();

  const [isUserModalOpen, setIsUserModalOpen] = useState(false);
  const [newUserName, setNewUserName] = useState('');
  const [newUserEmail, setNewUserEmail] = useState('');
  const [newUserPassword, setNewUserPassword] = useState('');
  const [newUserRole, setNewUserRole] = useState<'platform_admin' | 'team_lead' | 'viewer'>('team_lead');
  const [newUserCustomRoleId, setNewUserCustomRoleId] = useState<string>('');
  const [newUserGroupId, setNewUserGroupId] = useState<string>('');
  const [newUserStatus, setNewUserStatus] = useState<'active' | 'suspended'>('active');
  const [userFormError, setUserFormError] = useState<string | null>(null);

  // Edit user state
  const [editingUser, setEditingUser] = useState<AdminUserResponse | null>(null);
  const [isEditUserModalOpen, setIsEditUserModalOpen] = useState(false);
  const [editUserName, setEditUserName] = useState('');
  const [editUserRole, setEditUserRole] = useState<'platform_admin' | 'team_lead' | 'viewer'>('team_lead');
  const [editUserCustomRoleId, setEditUserCustomRoleId] = useState<string>('');
  const [editUserGroupId, setEditUserGroupId] = useState<string>('');
  const [editUserStatus, setEditUserStatus] = useState<'active' | 'suspended'>('active');
  const [editUserFormError, setEditUserFormError] = useState<string | null>(null);

  // Reset password state
  const [resetUser, setResetUser] = useState<AdminUserResponse | null>(null);
  const [isResetPasswordModalOpen, setIsResetPasswordModalOpen] = useState(false);
  const [newPasswordInput, setNewPasswordInput] = useState('');
  const [resetPasswordError, setResetPasswordError] = useState<string | null>(null);

  // Owner Groups state
  const { data: allOwnerGroups = [], isLoading: ownerGroupsLoading } = useOwnerGroups();
  const createOwnerGroupMutation = useCreateOwnerGroup();
  const updateOwnerGroupMutation = useUpdateOwnerGroup();
  const deleteOwnerGroupMutation = useDeleteOwnerGroup();

  const [groupFilter, setGroupFilter] = useState('');
  const [isOwnerGroupModalOpen, setIsOwnerGroupModalOpen] = useState(false);
  const [editingOwnerGroup, setEditingOwnerGroup] = useState<OwnerGroup | null>(null);
  const [groupName, setGroupName] = useState('');
  const [groupSlug, setGroupSlug] = useState('');
  const [groupDepartment, setGroupDepartment] = useState('');
  const [groupLeadName, setGroupLeadName] = useState('');
  const [groupLeadEmail, setGroupLeadEmail] = useState('');
  const [groupFormError, setGroupFormError] = useState<string | null>(null);

  // CI Classes state
  const { data: ciClasses = DEFAULT_CI_CLASSES, isLoading: classesLoading } = useCIClasses();
  const createClassMutation = useCreateCIClass();
  const updateClassMutation = useUpdateCIClass();
  const deleteClassMutation = useDeleteCIClass();

  const [classFilter, setClassFilter] = useState('');
  const [isClassModalOpen, setIsClassModalOpen] = useState(false);
  const [editingClass, setEditingClass] = useState<CIClassDefinition | null>(null);
  const [classKey, setClassKey] = useState('');
  const [classLabel, setClassLabel] = useState('');
  const [classCategory, setClassCategory] = useState('Application');
  const [classDescription, setClassDescription] = useState('');
  const [classIcon, setClassIcon] = useState('Layers');
  const [classAttributes, setClassAttributes] = useState('');
  const [classFormFields, setClassFormFields] = useState<CIFormField[]>([]);
  const [classFormError, setClassFormError] = useState<string | null>(null);

  // Dynamic Categories state
  const { data: categories = DEFAULT_CATEGORIES, isLoading: categoriesLoading } = useCategories();
  const createCategoryMutation = useCreateCategory();
  const updateCategoryMutation = useUpdateCategory();
  const deleteCategoryMutation = useDeleteCategory();

  const [categoryFilter, setCategoryFilter] = useState('');
  const [isCategoryModalOpen, setIsCategoryModalOpen] = useState(false);
  const [editingCategory, setEditingCategory] = useState<CategoryDefinition | null>(null);
  const [catId, setCatId] = useState('');
  const [catName, setCatName] = useState('');
  const [catDesc, setCatDesc] = useState('');
  const [catIcon, setCatIcon] = useState('Boxes');
  const [catColor, setCatColor] = useState('cyan');
  const [catFormError, setCatFormError] = useState<string | null>(null);

  // Dynamic Relationship Types state
  const { data: relationshipTypes = DEFAULT_RELATIONSHIP_TYPES, isLoading: relationshipsLoading } = useRelationshipTypes();
  const createRelationshipMutation = useCreateRelationshipType();
  const updateRelationshipMutation = useUpdateRelationshipType();
  const deleteRelationshipMutation = useDeleteRelationshipType();

  const [relationshipFilter, setRelationshipFilter] = useState('');
  const [isRelationshipModalOpen, setIsRelationshipModalOpen] = useState(false);
  const [editingRelationship, setEditingRelationship] = useState<RelationshipTypeDefinition | null>(null);
  const [relId, setRelId] = useState('');
  const [relLabel, setRelLabel] = useState('');
  const [relReverseLabel, setRelReverseLabel] = useState('');
  const [relDesc, setRelDesc] = useState('');
  const [relColor, setRelColor] = useState('purple');
  const [relFormError, setRelFormError] = useState<string | null>(null);

  // Field sub-editor state within CI Class modal
  const [isAddingField, setIsAddingField] = useState(false);
  const [fieldLabel, setFieldLabel] = useState('');
  const [fieldName, setFieldName] = useState('');
  const [fieldType, setFieldType] = useState<'text' | 'number' | 'select' | 'boolean'>('text');
  const [fieldRequired, setFieldRequired] = useState(false);
  const [fieldPlaceholder, setFieldPlaceholder] = useState('');
  const [fieldOptions, setFieldOptions] = useState('');
  const [fieldDefault, setFieldDefault] = useState('');

  const [clearingCache, setClearingCache] = useState(false);
  const [isConfirmFlushOpen, setIsConfirmFlushOpen] = useState(false);

  const handleTogglePermission = (permKey: string) => {
    setSelectedPermissions((prev) => {
      if (prev.includes(permKey)) {
        return prev.filter((k) => k !== permKey);
      }
      return [...prev, permKey];
    });
  };

  const handleCreateRole = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newRoleName.trim()) {
      setRoleFormError('Role name is required.');
      return;
    }
    if (selectedPermissions.length === 0) {
      setRoleFormError('Select at least one permission checkbox.');
      return;
    }

    try {
      await createRoleMutation.mutateAsync({
        name: newRoleName.trim(),
        description: newRoleDesc.trim(),
        permissions: selectedPermissions,
      });
      setIsRoleModalOpen(false);
      setNewRoleName('');
      setNewRoleDesc('');
      setSelectedPermissions([]);
      setRoleFormError(null);
      toast.success(`Role "${newRoleName.trim()}" created successfully`);
    } catch (err: any) {
      setRoleFormError(err?.message || 'Failed to create role');
    }
  };

  const handleDeleteRole = (role: CustomRole) => {
    const assignedUsers = adminUsers.filter((u) => u.custom_role_id === role.id);
    const isBlocked = role.is_system || assignedUsers.length > 0;
    const metrics: BlockingMetric[] = [];
    if (assignedUsers.length > 0) {
      metrics.push({ label: 'Assigned Users', count: assignedUsers.length });
    }

    setDeleteConfirm({
      open: true,
      itemType: 'Custom Role',
      itemName: role.name,
      isBlocked,
      blockReason: role.is_system
        ? `Role "${role.name}" is a protected system core role and cannot be deleted.`
        : isBlocked
        ? `Role "${role.name}" cannot be deleted because ${assignedUsers.length} active users are currently assigned this role. Reassign those accounts before deleting.`
        : undefined,
      blockingMetrics: metrics,
      onConfirm: async () => {
        try {
          await deleteRoleMutation.mutateAsync(role.id);
          setDeleteConfirm((prev) => ({ ...prev, open: false }));
          toast.info(`Role "${role.name}" deleted`);
        } catch (err: any) {
          toast.error(err?.message || 'Failed to delete role');
        }
      },
    });
  };

  const handleCreateUser = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newUserName.trim() || !newUserEmail.trim()) {
      setUserFormError('Name and email are required.');
      return;
    }

    try {
      await createUserMutation.mutateAsync({
        name: newUserName.trim(),
        email: newUserEmail.trim(),
        role: newUserRole,
        custom_role_id: newUserCustomRoleId || undefined,
        primary_owner_group_id: newUserGroupId || undefined,
        password: newUserPassword.trim() || undefined,
        status: newUserStatus,
      });
      setIsUserModalOpen(false);
      setNewUserName('');
      setNewUserEmail('');
      setNewUserPassword('');
      setNewUserCustomRoleId('');
      setNewUserGroupId('');
      setNewUserStatus('active');
      setUserFormError(null);
      toast.success(`User "${newUserName.trim()}" registered successfully`);
    } catch (err: any) {
      setUserFormError(err?.message || 'Failed to register user');
    }
  };

  const handleOpenEditUser = (user: AdminUserResponse) => {
    setEditingUser(user);
    setEditUserName(user.name);
    setEditUserRole((user.role as any) || 'team_lead');
    setEditUserCustomRoleId(user.custom_role_id || '');
    setEditUserGroupId(user.primary_owner_group_id || '');
    setEditUserStatus((user.status as any) || 'active');
    setEditUserFormError(null);
    setIsEditUserModalOpen(true);
  };

  const handleSaveEditUser = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingUser) return;
    if (!editUserName.trim()) {
      setEditUserFormError('Name is required.');
      return;
    }

    try {
      await updateUserMutation.mutateAsync({
        id: editingUser.id,
        data: {
          name: editUserName.trim(),
          role: editUserRole,
          custom_role_id: editUserCustomRoleId || undefined,
          primary_owner_group_id: editUserGroupId || undefined,
          status: editUserStatus,
        },
      });
      setIsEditUserModalOpen(false);
      setEditingUser(null);
      toast.success(`User "${editUserName.trim()}" updated successfully`);
    } catch (err: any) {
      setEditUserFormError(err?.message || 'Failed to update user');
    }
  };

  const handleOpenResetPassword = (user: AdminUserResponse) => {
    setResetUser(user);
    setNewPasswordInput('');
    setResetPasswordError(null);
    setIsResetPasswordModalOpen(true);
  };

  const handleSaveResetPassword = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!resetUser || !newPasswordInput.trim()) {
      setResetPasswordError('Password cannot be empty.');
      return;
    }
    try {
      await resetPasswordMutation.mutateAsync({
        id: resetUser.id,
        newPassword: newPasswordInput.trim(),
      });
      setIsResetPasswordModalOpen(false);
      setResetUser(null);
      toast.success(`Password reset for ${resetUser.name}`);
    } catch (err: any) {
      setResetPasswordError(err?.message || 'Failed to reset password');
    }
  };

  const handleOpenDeleteUser = (user: AdminUserResponse) => {
    const isSelf = user.id === currentUser?.id;
    setDeleteConfirm({
      open: true,
      itemType: 'User Account',
      itemName: `${user.name} (${user.email})`,
      isBlocked: isSelf,
      blockReason: isSelf ? 'You cannot delete your own currently authenticated administrative user account.' : undefined,
      description: `Are you sure you want to permanently delete user account "${user.name}" (${user.email})? All active sessions for this account will be immediately terminated.`,
      onConfirm: async () => {
        try {
          await deleteUserMutation.mutateAsync(user.id);
          setDeleteConfirm((prev) => ({ ...prev, open: false }));
          toast.info(`User "${user.name}" deleted`);
        } catch (err: any) {
          toast.error(err?.message || 'Failed to delete user');
        }
      },
    });
  };

  const handleRevokeSession = async (sessionID: string) => {
    try {
      await revokeSessionMutation.mutateAsync(sessionID);
      toast.success('Session revoked successfully');
    } catch (err: any) {
      toast.error(err?.message || 'Failed to revoke session');
    }
  };

  // Owner Group Handlers
  const handleOpenCreateGroup = () => {
    setEditingOwnerGroup(null);
    setGroupName('');
    setGroupSlug('');
    setGroupDepartment('');
    setGroupLeadName('');
    setGroupLeadEmail('');
    setGroupFormError(null);
    setIsOwnerGroupModalOpen(true);
  };

  const handleOpenEditGroup = (group: OwnerGroup) => {
    setEditingOwnerGroup(group);
    setGroupName(group.name);
    setGroupSlug(group.slug || '');
    setGroupDepartment(group.department_name);
    setGroupLeadName(group.team_lead_name);
    setGroupLeadEmail(group.team_lead_email);
    setGroupFormError(null);
    setIsOwnerGroupModalOpen(true);
  };

  const handleSaveGroup = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!groupName.trim() || !groupDepartment.trim()) {
      setGroupFormError('Group name and department are required.');
      return;
    }
    if (!groupLeadName.trim() || !groupLeadEmail.trim()) {
      setGroupFormError('Team lead name and email are required.');
      return;
    }

    try {
      if (editingOwnerGroup) {
        await updateOwnerGroupMutation.mutateAsync({
          id: editingOwnerGroup.id,
          data: {
            name: groupName.trim(),
            slug: groupSlug.trim() || undefined,
            department_name: groupDepartment.trim(),
            team_lead_name: groupLeadName.trim(),
            team_lead_email: groupLeadEmail.trim(),
          },
        });
      } else {
        await createOwnerGroupMutation.mutateAsync({
          name: groupName.trim(),
          slug: groupSlug.trim() || undefined,
          department_name: groupDepartment.trim(),
          team_lead_name: groupLeadName.trim(),
          team_lead_email: groupLeadEmail.trim(),
        });
      }
      setIsOwnerGroupModalOpen(false);
      setEditingOwnerGroup(null);
      setGroupFormError(null);
      toast.success(`Owner group "${groupName.trim()}" saved`);
    } catch (err: any) {
      setGroupFormError(err?.message || 'Failed to save owner group');
    }
  };

  const handleDeleteGroup = (group: OwnerGroup) => {
    const activeCIs = catalogCIs.filter((c) => c.owner_group_id === group.id);
    const assignedUsers = adminUsers.filter((u) => u.primary_owner_group_id === group.id);
    const isBlocked = activeCIs.length > 0 || assignedUsers.length > 0;
    const metrics: BlockingMetric[] = [];
    if (activeCIs.length > 0) metrics.push({ label: 'Assigned CIs', count: activeCIs.length });
    if (assignedUsers.length > 0) metrics.push({ label: 'Boundary Users', count: assignedUsers.length });

    setDeleteConfirm({
      open: true,
      itemType: 'Owner Group',
      itemName: group.name,
      isBlocked,
      blockReason: isBlocked
        ? `Owner group "${group.name}" cannot be deleted because ${metrics.map((m) => `${m.count} ${m.label}`).join(' and ')} are actively bound to this ownership domain. Reassign these resources before deletion.`
        : undefined,
      blockingMetrics: metrics,
      onConfirm: async () => {
        try {
          await deleteOwnerGroupMutation.mutateAsync(group.id);
          setDeleteConfirm((prev) => ({ ...prev, open: false }));
          toast.info(`Owner group "${group.name}" deleted`);
        } catch (err: any) {
          toast.error(err?.message || 'Failed to delete owner group');
        }
      },
    });
  };

  // CI Class Handlers
  const handleOpenCreateClass = () => {
    setEditingClass(null);
    setClassKey('');
    setClassLabel('');
    setClassCategory(categories[0]?.name || 'Application');
    setClassDescription('');
    setClassIcon('Layers');
    setClassAttributes('');
    setClassFormFields([]);
    setIsAddingField(false);
    setClassFormError(null);
    setIsClassModalOpen(true);
  };

  const handleOpenEditClass = (cls: CIClassDefinition) => {
    setEditingClass(cls);
    setClassKey(cls.id);
    setClassLabel(cls.label);
    setClassCategory(cls.category);
    setClassDescription(cls.description || '');
    setClassIcon(cls.icon || 'Layers');
    setClassAttributes((cls.attributes || []).join(', '));
    setClassFormFields(cls.form_fields || []);
    setIsAddingField(false);
    setClassFormError(null);
    setIsClassModalOpen(true);
  };

  const applyFormTemplate = (type: 'vm_server' | 'database' | 'microservice') => {
    if (type === 'vm_server') {
      setClassKey('vm_server');
      setClassLabel('VM Server');
      setClassCategory('Infrastructure');
      setClassIcon('Server');
      setClassDescription('Virtual machine server instance with compute, storage, and networking specs');
      setClassFormFields([
        { name: 'server_name', label: 'Server Name', type: 'text', required: true, placeholder: 'e.g. srv-prod-vm01' },
        { name: 'ip_address', label: 'IP Address', type: 'text', required: true, placeholder: 'e.g. 10.240.12.8' },
        { name: 'operating_system', label: 'Operating System', type: 'select', required: true, options: ['Ubuntu 22.04 LTS', 'Debian 12', 'RHEL 9', 'Windows Server 2022', 'Alpine Linux'], default_value: 'Ubuntu 22.04 LTS' },
        { name: 'memory_size', label: 'Memory Size', type: 'text', required: true, placeholder: 'e.g. 64 GB' },
        { name: 'allocated_storage', label: 'Allocated Storage', type: 'text', required: true, placeholder: 'e.g. 500 GB NVMe' },
      ]);
    } else if (type === 'database') {
      setClassKey('database');
      setClassLabel('Database Instance');
      setClassCategory('Data');
      setClassIcon('Database');
      setClassDescription('Transactional database, analytical warehouse, or cache instance');
      setClassFormFields([
        { name: 'engine', label: 'Database Engine', type: 'select', required: true, options: ['PostgreSQL', 'MySQL', 'Redis', 'CockroachDB', 'MongoDB', 'Oracle'], default_value: 'PostgreSQL' },
        { name: 'version', label: 'Engine Major Version', type: 'text', required: true, placeholder: '16.4' },
        { name: 'port', label: 'Network Port', type: 'number', required: true, placeholder: '5432' },
        { name: 'storage_gb', label: 'Allocated Storage (GB)', type: 'number', required: false, placeholder: '250' },
      ]);
    } else if (type === 'microservice') {
      setClassKey('application');
      setClassLabel('Microservice');
      setClassCategory('Application');
      setClassIcon('Cpu');
      setClassDescription('Core software microservice, backend worker, or application component');
      setClassFormFields([
        { name: 'runtime', label: 'Execution Runtime', type: 'select', required: true, options: ['Go 1.23', 'Java OpenJDK 21', 'Node.js 22', 'Python 3.12', 'Rust 1.82', '.NET 8'], default_value: 'Go 1.23' },
        { name: 'framework', label: 'Application Framework', type: 'text', required: false, placeholder: 'e.g. Chi, Spring Boot, Express, FastAPI' },
        { name: 'repository_url', label: 'Git Repository URL', type: 'text', required: false, placeholder: 'git@github.com:org/service.git' },
        { name: 'health_check_path', label: 'HTTP Health Endpoint', type: 'text', required: false, placeholder: '/healthz' },
      ]);
    }
  };

  const handleAddField = () => {
    if (!fieldName.trim() || !fieldLabel.trim()) {
      return;
    }
    const cleanName = fieldName.trim().toLowerCase().replace(/[^a-z0-9_]/g, '_');
    const optionsArray = fieldOptions
      ? fieldOptions.split(',').map((o) => o.trim()).filter((o) => o.length > 0)
      : undefined;

    const newField: CIFormField = {
      name: cleanName,
      label: fieldLabel.trim(),
      type: fieldType,
      required: fieldRequired,
      placeholder: fieldPlaceholder.trim() || undefined,
      options: optionsArray,
      default_value: fieldDefault.trim() || undefined,
    };

    setClassFormFields((prev) => [...prev.filter((f) => f.name !== cleanName), newField]);
    setFieldName('');
    setFieldLabel('');
    setFieldType('text');
    setFieldRequired(false);
    setFieldPlaceholder('');
    setFieldOptions('');
    setFieldDefault('');
    setIsAddingField(false);
  };

  const handleRemoveField = (nameToRemove: string) => {
    setClassFormFields((prev) => prev.filter((f) => f.name !== nameToRemove));
  };

  const handleSaveClass = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!classKey.trim() || !classLabel.trim()) {
      setClassFormError('Class identifier and display label are required.');
      return;
    }

    const attrs = classFormFields.length > 0
      ? classFormFields.map((f) => f.name)
      : classAttributes
          .split(',')
          .map((a) => a.trim())
          .filter((a) => a.length > 0);

    try {
      if (editingClass) {
        await updateClassMutation.mutateAsync({
          id: editingClass.id,
          data: {
            label: classLabel.trim(),
            category: classCategory,
            description: classDescription.trim(),
            icon: classIcon,
            attributes: attrs,
            form_fields: classFormFields,
          },
        });
      } else {
        await createClassMutation.mutateAsync({
          id: classKey.trim(),
          label: classLabel.trim(),
          category: classCategory,
          description: classDescription.trim(),
          icon: classIcon,
          attributes: attrs,
          form_fields: classFormFields,
        });
      }
      setIsClassModalOpen(false);
      setEditingClass(null);
      setClassFormError(null);
      toast.success(`CI class "${classLabel.trim()}" saved`);
    } catch (err: any) {
      setClassFormError(err?.message || 'Failed to save CI class');
    }
  };

  const handleDeleteClass = (cls: CIClassDefinition) => {
    const activeCIs = catalogCIs.filter((c) => c.ci_class === cls.id);
    const isBlocked = activeCIs.length > 0;
    const metrics: BlockingMetric[] = [];
    if (activeCIs.length > 0) {
      metrics.push({ label: 'Active CIs', count: activeCIs.length });
    }

    setDeleteConfirm({
      open: true,
      itemType: 'CI Class',
      itemName: `${cls.label} (${cls.id})`,
      isBlocked,
      blockReason: isBlocked
        ? `CI class "${cls.label}" cannot be deleted because ${activeCIs.length} Configuration Items are currently registered under this class. You must reassign or retire all associated CIs before deleting.`
        : undefined,
      blockingMetrics: metrics,
      onConfirm: async () => {
        try {
          await deleteClassMutation.mutateAsync(cls.id);
          setDeleteConfirm((prev) => ({ ...prev, open: false }));
          toast.info(`CI class "${cls.label}" deleted`);
        } catch (err: any) {
          toast.error(err?.message || 'Failed to delete CI class');
        }
      },
    });
  };

  // Category Handlers
  const handleOpenCreateCategory = () => {
    setEditingCategory(null);
    setCatId('');
    setCatName('');
    setCatDesc('');
    setCatIcon('Boxes');
    setCatColor('cyan');
    setCatFormError(null);
    setIsCategoryModalOpen(true);
  };

  const handleOpenEditCategory = (cat: CategoryDefinition) => {
    setEditingCategory(cat);
    setCatId(cat.id);
    setCatName(cat.name);
    setCatDesc(cat.description || '');
    setCatIcon(cat.icon || 'Boxes');
    setCatColor(cat.color || 'cyan');
    setCatFormError(null);
    setIsCategoryModalOpen(true);
  };

  const handleSaveCategory = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!catName.trim()) {
      setCatFormError('Category name is required.');
      return;
    }
    const cleanId = (catId.trim() || catName.trim().toLowerCase().replace(/[^a-z0-9_]/g, '_'));

    try {
      if (editingCategory) {
        await updateCategoryMutation.mutateAsync({
          id: editingCategory.id,
          data: {
            name: catName.trim(),
            description: catDesc.trim(),
            icon: catIcon,
            color: catColor,
          },
        });
      } else {
        await createCategoryMutation.mutateAsync({
          id: cleanId,
          name: catName.trim(),
          description: catDesc.trim(),
          icon: catIcon,
          color: catColor,
        });
      }
      setIsCategoryModalOpen(false);
      setEditingCategory(null);
      setCatFormError(null);
      toast.success(`Category "${catName.trim()}" saved`);
    } catch (err: any) {
      setCatFormError(err?.message || 'Failed to save category');
    }
  };

  const handleDeleteCategory = (cat: CategoryDefinition) => {
    const isBlocked = (cat.class_count || 0) > 0 || (cat.ci_count || 0) > 0;
    const metrics: BlockingMetric[] = [];
    if ((cat.class_count || 0) > 0) metrics.push({ label: 'CI Classes', count: cat.class_count });
    if ((cat.ci_count || 0) > 0) metrics.push({ label: 'Active CIs', count: cat.ci_count });

    setDeleteConfirm({
      open: true,
      itemType: 'Category',
      itemName: cat.name,
      isBlocked,
      blockReason: isBlocked
        ? `Operational category "${cat.name}" cannot be deleted because it is currently referenced by ${metrics.map((m) => `${m.count} ${m.label}`).join(' and ')}. You must reassign or remove all dependent classes and CIs first.`
        : undefined,
      blockingMetrics: metrics,
      onConfirm: async () => {
        try {
          await deleteCategoryMutation.mutateAsync(cat.id);
          setDeleteConfirm((prev) => ({ ...prev, open: false }));
          toast.info(`Category "${cat.name}" deleted`);
        } catch (err: any) {
          toast.error(err?.message || 'Failed to delete category');
        }
      },
    });
  };

  // Relationship Type Handlers
  const handleOpenCreateRelationship = () => {
    setEditingRelationship(null);
    setRelId('');
    setRelLabel('');
    setRelReverseLabel('');
    setRelDesc('');
    setRelColor('purple');
    setRelFormError(null);
    setIsRelationshipModalOpen(true);
  };

  const handleOpenEditRelationship = (rel: RelationshipTypeDefinition) => {
    setEditingRelationship(rel);
    setRelId(rel.id);
    setRelLabel(rel.label);
    setRelReverseLabel(rel.reverse_label || '');
    setRelDesc(rel.description || '');
    setRelColor(rel.color || 'purple');
    setRelFormError(null);
    setIsRelationshipModalOpen(true);
  };

  const handleSaveRelationship = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!relLabel.trim()) {
      setRelFormError('Relationship label is required.');
      return;
    }
    const cleanId = (relId.trim() || relLabel.trim().toLowerCase().replace(/[^a-z0-9_]/g, '_'));

    try {
      if (editingRelationship) {
        await updateRelationshipMutation.mutateAsync({
          id: editingRelationship.id,
          data: {
            label: relLabel.trim(),
            reverse_label: relReverseLabel.trim() || undefined,
            description: relDesc.trim(),
            color: relColor,
          },
        });
      } else {
        await createRelationshipMutation.mutateAsync({
          id: cleanId,
          label: relLabel.trim(),
          reverse_label: relReverseLabel.trim() || undefined,
          description: relDesc.trim(),
          color: relColor,
        });
      }
      setIsRelationshipModalOpen(false);
      setEditingRelationship(null);
      setRelFormError(null);
      toast.success(`Relationship "${relLabel.trim()}" saved`);
    } catch (err: any) {
      setRelFormError(err?.message || 'Failed to save relationship');
    }
  };

  const handleDeleteRelationship = (rel: RelationshipTypeDefinition) => {
    const isBlocked = (rel.edge_count || 0) > 0;
    const metrics: BlockingMetric[] = [];
    if ((rel.edge_count || 0) > 0) {
      metrics.push({ label: 'Active Graph Edges', count: rel.edge_count });
    }

    setDeleteConfirm({
      open: true,
      itemType: 'Relationship Type',
      itemName: `${rel.label} (${rel.id})`,
      isBlocked,
      blockReason: isBlocked
        ? `Relationship type "${rel.label}" cannot be deleted because ${rel.edge_count} dependency topology edges currently use this type in the configuration mesh. Disconnect or update those edges before deleting.`
        : undefined,
      blockingMetrics: metrics,
      onConfirm: async () => {
        try {
          await deleteRelationshipMutation.mutateAsync(rel.id);
          setDeleteConfirm((prev) => ({ ...prev, open: false }));
          toast.info(`Relationship type "${rel.label}" deleted`);
        } catch (err: any) {
          toast.error(err?.message || 'Failed to delete relationship type');
        }
      },
    });
  };

  const renderIcon = (iconName: string, className = 'w-3.5 h-3.5') => {
    switch (iconName) {
      case 'Cpu': return <Cpu className={className} />;
      case 'Database': return <Database className={className} />;
      case 'Server': return <Server className={className} />;
      case 'HardDrive': return <HardDrive className={className} />;
      case 'Network': return <Network className={className} />;
      case 'Radio': return <Radio className={className} />;
      case 'Workflow': return <Workflow className={className} />;
      case 'Boxes': return <Boxes className={className} />;
      case 'Cloud': return <Cloud className={className} />;
      case 'Shield': return <Shield className={className} />;
      case 'GitFork': return <GitFork className={className} />;
      default: return <Layers className={className} />;
    }
  };

  const getCategoryColor = (cat: CategoryDefinition) => {
    const raw = (cat.color || '').toLowerCase();
    if (raw === 'amber') return 'blue';
    if (raw === 'rose') return 'indigo';
    if (raw && raw !== 'cyan') return raw;

    const id = (cat.id || '').toLowerCase();
    const name = (cat.name || '').toLowerCase();
    if (id === 'service' || name.includes('service')) return 'purple';
    if (id === 'data' || id === 'database' || name.includes('data') || name.includes('database')) return 'emerald';
    if (id === 'infrastructure' || name.includes('infra')) return 'blue';
    if (id === 'network' || name.includes('network')) return 'indigo';
    if (id === 'application' || name.includes('application')) return 'cyan';
    return 'slate';
  };

  const renderColorBadge = (colorKey: string) => {
    const opt = COLOR_OPTIONS.find((c) => c.value === colorKey) || COLOR_OPTIONS[0];
    return (
      <span className={cn('inline-flex items-center gap-1.5 px-2 py-0.5 rounded text-3xs font-mono font-medium border', opt.bg, opt.text, opt.border)}>
        <span className={cn('w-1.5 h-1.5 rounded-full', opt.dot)} />
        <span>{opt.label}</span>
      </span>
    );
  };

  const handleClearCache = async () => {
    setClearingCache(true);
    await queryClient.invalidateQueries();
    setTimeout(() => {
      setClearingCache(false);
      toast.success('System cache successfully reloaded');
    }, 500);
  };

  const tabs = [
    { id: 'roles', label: 'Roles', icon: Shield },
    { id: 'users', label: 'Users', icon: Users },
    { id: 'administration', label: 'Administration', icon: Sliders },
    { id: 'system', label: 'System', icon: Server },
  ] as const;

  const filteredOwnerGroups = allOwnerGroups.filter((g) => {
    if (!groupFilter.trim()) return true;
    const q = groupFilter.toLowerCase();
    return (
      g.name.toLowerCase().includes(q) ||
      g.department_name.toLowerCase().includes(q) ||
      g.team_lead_name.toLowerCase().includes(q) ||
      (g.slug && g.slug.toLowerCase().includes(q))
    );
  });

  const filteredClasses = ciClasses.filter((c) => {
    if (!classFilter.trim()) return true;
    const q = classFilter.toLowerCase();
    return (
      c.label.toLowerCase().includes(q) ||
      c.id.toLowerCase().includes(q) ||
      c.category.toLowerCase().includes(q) ||
      (c.description && c.description.toLowerCase().includes(q))
    );
  });

  const filteredCategories = categories.filter((c) => {
    if (!categoryFilter.trim()) return true;
    const q = categoryFilter.toLowerCase();
    return (
      c.name.toLowerCase().includes(q) ||
      c.id.toLowerCase().includes(q) ||
      (c.description && c.description.toLowerCase().includes(q))
    );
  });

  const filteredRelationships = relationshipTypes.filter((r) => {
    if (!relationshipFilter.trim()) return true;
    const q = relationshipFilter.toLowerCase();
    return (
      r.label.toLowerCase().includes(q) ||
      r.id.toLowerCase().includes(q) ||
      (r.reverse_label && r.reverse_label.toLowerCase().includes(q)) ||
      (r.description && r.description.toLowerCase().includes(q))
    );
  });

  return (
    <div className="space-y-4 w-full animate-in fade-in-50 duration-150">
      {/* Sub-Tabs */}
      <div className="flex items-center justify-start overflow-x-auto border-b border-hairline pb-2">
        <div className="flex items-center gap-1.5">
          {tabs.map((tab) => {
            const Icon = tab.icon;
            const isActive = activeTab === tab.id;
            return (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={cn(
                  'flex items-center gap-2 px-3 py-1.5 rounded text-xs font-medium transition-colors cursor-pointer',
                  isActive
                    ? 'bg-accent/15 text-accent font-semibold border border-accent/30 shadow-xs'
                    : 'text-secondary hover:text-primary hover:bg-hover'
                )}
              >
                <Icon className={cn('w-3.5 h-3.5', isActive ? 'text-accent' : 'text-muted')} />
                <span>{tab.label}</span>
              </button>
            );
          })}
        </div>
      </div>

      {/* 1. Custom Roles & Permissions Tab */}
      {activeTab === 'roles' && (
        <div className="space-y-4">
          <Card>
            <CardHeader className="flex flex-row items-center justify-between pb-2">
              <CardTitle className="text-sm font-semibold flex items-center gap-2">
                <Shield className="w-4 h-4 text-accent" />
                Custom Roles
              </CardTitle>
              <Button
                size="sm"
                onClick={() => {
                  setNewRoleName('');
                  setNewRoleDesc('');
                  setSelectedPermissions(['ci:read']);
                  setRoleFormError(null);
                  setIsRoleModalOpen(true);
                }}
                className="gap-1.5 bg-accent hover:bg-accent-hover text-white text-xs cursor-pointer"
              >
                <Plus className="w-3.5 h-3.5" />
                <span>Create Role</span>
              </Button>
            </CardHeader>
            <CardContent>
              {rolesLoading ? (
                <div className="py-8 text-center text-xs text-muted">Loading custom roles...</div>
              ) : (
                <div className="border border-hairline rounded-md overflow-hidden bg-surface">
                  <div className="overflow-x-auto">
                    <table className="w-full text-xs text-left">
                      <thead className="bg-canvas border-b border-hairline font-mono text-3xs uppercase tracking-wider text-muted">
                        <tr>
                          <th className="py-2.5 px-3">Role</th>
                          <th className="py-2.5 px-3">Description</th>
                          <th className="py-2.5 px-3">Capabilities</th>
                          <th className="py-2.5 px-3 text-right">Actions</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-subtle">
                        {customRoles.map((role) => (
                          <tr key={role.id} className="hover:bg-hover/60 transition-colors">
                            <td className="py-2.5 px-3 font-semibold text-primary">
                              <div className="flex items-center gap-2">
                                <span>{role.name}</span>
                                {role.is_system && (
                                  <Badge variant="info" className="text-3xs font-mono">
                                    System
                                  </Badge>
                                )}
                              </div>
                            </td>
                            <td className="py-2.5 px-3 text-secondary text-2xs max-w-xs truncate">
                              {role.description || '—'}
                            </td>
                            <td className="py-2.5 px-3">
                              <div className="flex flex-wrap gap-1">
                                {role.permissions.map((p) => (
                                  <span
                                    key={p}
                                    className={cn(
                                      'px-1.5 py-0.5 rounded text-3xs font-mono font-medium',
                                      p === 'admin:all'
                                        ? 'bg-tier1-bg text-tier1 border border-tier1-border font-semibold'
                                        : 'bg-surface-sunken text-secondary border border-subtle'
                                    )}
                                  >
                                    {p}
                                  </span>
                                ))}
                              </div>
                            </td>
                            <td className="py-2.5 px-3 text-right">
                              <RowActionsMenu
                                actions={[
                                  {
                                    label: 'Delete Role',
                                    icon: <Trash2 className="w-3.5 h-3.5" />,
                                    variant: 'danger',
                                    onClick: () => handleDeleteRole(role),
                                  },
                                ]}
                              />
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      )}

      {/* 2. User Accounts Management Tab */}
      {activeTab === 'users' && (
        <div className="space-y-6">
          <Card>
            <CardHeader className="flex flex-row items-center justify-between pb-2">
              <div>
                <CardTitle className="text-sm font-semibold flex items-center gap-2">
                  <Users className="w-4 h-4 text-accent" />
                  User Accounts
                </CardTitle>
                <p className="text-2xs text-secondary mt-0.5">
                  Configure enterprise user credentials, boundary owner group assignments, and access roles
                </p>
              </div>
              <Button
                size="sm"
                onClick={() => {
                  setNewUserName('');
                  setNewUserEmail('');
                  setNewUserPassword('');
                  setNewUserRole('team_lead');
                  setNewUserCustomRoleId(customRoles[1]?.id || '');
                  setNewUserGroupId(allOwnerGroups[0]?.id || '');
                  setNewUserStatus('active');
                  setUserFormError(null);
                  setIsUserModalOpen(true);
                }}
                className="gap-1.5 bg-accent hover:bg-accent-hover text-white text-xs cursor-pointer"
              >
                <Plus className="w-3.5 h-3.5" />
                <span>Add User</span>
              </Button>
            </CardHeader>
            <CardContent>
              {usersLoading ? (
                <div className="py-8 text-center text-xs text-muted">Loading user accounts...</div>
              ) : (
                <div className="border border-hairline rounded-md overflow-hidden bg-surface">
                  <div className="overflow-x-auto">
                    <table className="w-full text-xs text-left">
                      <thead className="bg-canvas border-b border-hairline font-mono text-3xs uppercase tracking-wider text-muted">
                        <tr>
                          <th className="py-2.5 px-3">Name</th>
                          <th className="py-2.5 px-3">Email</th>
                          <th className="py-2.5 px-3">System Role</th>
                          <th className="py-2.5 px-3">Custom Role</th>
                          <th className="py-2.5 px-3">Boundary Scope</th>
                          <th className="py-2.5 px-3">Status</th>
                          <th className="py-2.5 px-3 text-right">Actions</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-subtle">
                        {adminUsers.map((user) => (
                          <tr key={user.id} className="hover:bg-hover/60 transition-colors">
                            <td className="py-2.5 px-3 font-semibold text-primary flex items-center gap-2">
                              <div className="w-6 h-6 rounded-full bg-accent/20 text-accent font-bold text-3xs flex items-center justify-center font-mono">
                                {user.name.charAt(0).toUpperCase()}
                              </div>
                              <div>
                                <span className="block font-medium">{user.name}</span>
                                {user.id === currentUser?.id && (
                                  <span className="text-3xs text-accent font-mono font-semibold">(You)</span>
                                )}
                              </div>
                            </td>
                            <td className="py-2.5 px-3 font-mono text-secondary text-2xs">
                              {user.email}
                            </td>
                            <td className="py-2.5 px-3">
                              <span className="font-mono text-3xs uppercase px-1.5 py-0.5 rounded bg-canvas border border-hairline text-secondary">
                                {user.role}
                              </span>
                            </td>
                            <td className="py-2.5 px-3">
                              {user.custom_role_name ? (
                                <span className="text-xs font-semibold text-accent">
                                  {user.custom_role_name}
                                </span>
                              ) : (
                                <span className="text-muted text-2xs">—</span>
                              )}
                            </td>
                            <td className="py-2.5 px-3 text-secondary text-2xs font-medium">
                              {user.role === 'platform_admin' ? (
                                <span className="text-accent flex items-center gap-1 font-mono text-3xs font-semibold">
                                  <Globe className="w-3 h-3 text-accent" /> Global Scope
                                </span>
                              ) : (
                                <span>{user.owner_group_name || '—'}</span>
                              )}
                            </td>
                            <td className="py-2.5 px-3">
                              <span
                                className={cn(
                                  'px-1.5 py-0.5 rounded text-3xs font-mono font-medium border',
                                  user.status === 'suspended'
                                    ? 'bg-tier1-bg text-tier1 border-tier1-border'
                                    : 'bg-accent-subtle text-inservice border-inservice/30'
                                )}
                              >
                                {user.status || 'active'}
                              </span>
                            </td>
                            <td className="py-2.5 px-3 text-right">
                              <RowActionsMenu
                                actions={[
                                  {
                                    label: 'Edit User',
                                    icon: <Pencil className="w-3.5 h-3.5" />,
                                    onClick: () => handleOpenEditUser(user),
                                  },
                                  {
                                    label: 'Reset Password',
                                    icon: <Key className="w-3.5 h-3.5" />,
                                    onClick: () => handleOpenResetPassword(user),
                                  },
                                  {
                                    label: 'Delete User',
                                    icon: <Trash2 className="w-3.5 h-3.5" />,
                                    variant: 'danger',
                                    onClick: () => handleOpenDeleteUser(user),
                                  },
                                ]}
                              />
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
            </CardContent>
          </Card>

          {/* Active User Sessions Table */}
          <Card>
            <CardHeader className="flex flex-row items-center justify-between pb-2">
              <div>
                <CardTitle className="text-sm font-semibold flex items-center gap-2">
                  <Activity className="w-4 h-4 text-accent" />
                  Active User Sessions
                </CardTitle>
                <p className="text-2xs text-secondary mt-0.5">
                  Track and revoke authenticated enterprise sessions across browsers and API clients
                </p>
              </div>
              <Badge variant="neutral" className="text-3xs font-mono">
                {userSessions.length} Active Sessions
              </Badge>
            </CardHeader>
            <CardContent>
              {sessionsLoading ? (
                <div className="py-6 text-center text-xs text-muted">Loading active sessions...</div>
              ) : userSessions.length === 0 ? (
                <div className="py-6 text-center text-xs text-muted italic">
                  No active persistent sessions found.
                </div>
              ) : (
                <div className="border border-hairline rounded-md overflow-hidden bg-surface">
                  <div className="overflow-x-auto">
                    <table className="w-full text-xs text-left">
                      <thead className="bg-canvas border-b border-hairline font-mono text-3xs uppercase tracking-wider text-muted">
                        <tr>
                          <th className="py-2.5 px-3">Session Token</th>
                          <th className="py-2.5 px-3">User</th>
                          <th className="py-2.5 px-3">IP Address</th>
                          <th className="py-2.5 px-3">Client / User Agent</th>
                          <th className="py-2.5 px-3">Last Active</th>
                          <th className="py-2.5 px-3 text-right">Revoke</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-subtle">
                        {userSessions.map((sess) => (
                          <tr key={sess.id} className="hover:bg-hover/60 transition-colors font-mono text-2xs">
                            <td className="py-2.5 px-3 text-accent font-semibold">
                              {sess.token ? sess.token.slice(0, 16) : sess.id.slice(0, 8)}...
                            </td>
                            <td className="py-2.5 px-3 text-primary font-sans font-medium">
                              <div>{sess.user_name}</div>
                              <div className="text-3xs text-secondary font-mono">{sess.user_email}</div>
                            </td>
                            <td className="py-2.5 px-3 text-secondary">
                              {sess.ip_address || '127.0.0.1'}
                            </td>
                            <td className="py-2.5 px-3 text-secondary max-w-xs truncate font-sans text-3xs">
                              {sess.user_agent || 'ETCMS Console Client'}
                            </td>
                            <td className="py-2.5 px-3 text-secondary text-3xs">
                              {sess.last_activity_at ? new Date(sess.last_activity_at).toLocaleString() : '—'}
                            </td>
                            <td className="py-2.5 px-3 text-right font-sans">
                              <Button
                                size="sm"
                                variant="outline"
                                onClick={() => handleRevokeSession(sess.id)}
                                disabled={revokeSessionMutation.isPending}
                                className="h-6.5 px-2 text-3xs text-tier0 hover:bg-tier0-bg border-tier0-border cursor-pointer"
                              >
                                Revoke
                              </Button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      )}

      {/* 3. Administration Tab (Dynamic Classes, Categories, Relationships & Groups) */}
      {activeTab === 'administration' && (
        <div className="space-y-4">
          {/* Sub-Navigation for Administration */}
          <div className="flex items-center justify-between border-b border-hairline pb-2.5">
            <div className="flex items-center gap-1.5">
              {[
                { id: 'classes', label: 'CI Classes', icon: Layers, count: filteredClasses.length },
                { id: 'categories', label: 'Categories', icon: Boxes, count: filteredCategories.length },
                { id: 'relationships', label: 'Custom Relationships', icon: GitFork, count: filteredRelationships.length },
                { id: 'groups', label: 'Owner Groups', icon: Building2, count: filteredOwnerGroups.length },
              ].map((sec) => {
                const Icon = sec.icon;
                const isActive = adminSection === sec.id;
                return (
                  <button
                    key={sec.id}
                    onClick={() => setAdminSection(sec.id as any)}
                    className={cn(
                      'flex items-center gap-2 px-3 py-1.5 rounded text-xs font-medium transition-colors cursor-pointer',
                      isActive
                        ? 'bg-accent/15 text-accent font-semibold border border-accent/30 shadow-xs'
                        : 'text-secondary hover:text-primary hover:bg-hover'
                    )}
                  >
                    <Icon className={cn('w-3.5 h-3.5', isActive ? 'text-accent' : 'text-muted')} />
                    <span>{sec.label}</span>
                    <span
                      className={cn(
                        'px-1.5 py-0.5 rounded-full text-3xs font-mono font-medium',
                        isActive ? 'bg-accent/25 text-accent' : 'bg-surface-sunken text-muted'
                      )}
                    >
                      {sec.count}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Section A: CI Classes */}
          {adminSection === 'classes' && (
            <Card>
              <CardHeader className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-3">
                <div>
                  <CardTitle className="text-sm font-semibold flex items-center gap-2">
                    <Layers className="w-4 h-4 text-accent" />
                    CI Classes & Dynamic Forms
                  </CardTitle>
                  <p className="text-2xs text-secondary mt-0.5">
                    Define operational configuration classes and dynamic schema input fields. All classes are fully customizable with referential deletion protection.
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <div className="relative">
                    <Search className="w-3.5 h-3.5 text-muted absolute left-2 top-2" />
                    <Input
                      placeholder="Filter classes..."
                      value={classFilter}
                      onChange={(e) => setClassFilter(e.target.value)}
                      className="h-7.5 pl-7 text-xs w-48"
                    />
                  </div>
                  <Button
                    size="sm"
                    onClick={handleOpenCreateClass}
                    className="gap-1.5 bg-accent hover:bg-accent-hover text-white text-xs shrink-0 cursor-pointer"
                  >
                    <Plus className="w-3.5 h-3.5" />
                    <span>Create CI Class</span>
                  </Button>
                </div>
              </CardHeader>
              <CardContent>
                {classesLoading ? (
                  <div className="py-8 text-center text-xs text-muted">Loading CI classes...</div>
                ) : (
                  <div className="border border-hairline rounded-md overflow-hidden bg-surface">
                    <div className="overflow-x-auto">
                      <table className="w-full text-xs text-left">
                        <thead className="bg-canvas border-b border-hairline font-mono text-3xs uppercase tracking-wider text-muted">
                          <tr>
                            <th className="py-2.5 px-3">Class Key</th>
                            <th className="py-2.5 px-3">Label</th>
                            <th className="py-2.5 px-3">Category</th>
                            <th className="py-2.5 px-3">Description</th>
                            <th className="py-2.5 px-3">Form Fields</th>
                            <th className="py-2.5 px-3">Active CIs</th>
                            <th className="py-2.5 px-3 text-right">Actions</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-subtle">
                          {filteredClasses.length === 0 ? (
                            <tr>
                              <td colSpan={7} className="py-6 text-center text-xs text-muted">
                                No CI classes found.
                              </td>
                            </tr>
                          ) : (
                            filteredClasses.map((cls) => {
                              const activeCIsCount = catalogCIs.filter((c) => c.ci_class === cls.id).length;
                              return (
                                <tr key={cls.id} className="hover:bg-hover/60 transition-colors">
                                  <td className="py-2.5 px-3 font-mono font-semibold text-primary">
                                    <div className="flex items-center gap-2">
                                      <span className="p-1 rounded bg-canvas border border-hairline text-accent">
                                        {renderIcon(cls.icon || 'Layers', 'w-3.5 h-3.5')}
                                      </span>
                                      <span>{cls.id}</span>
                                    </div>
                                  </td>
                                  <td className="py-2.5 px-3 text-primary font-medium">
                                    {cls.label}
                                  </td>
                                  <td className="py-2.5 px-3">
                                    <span className="font-mono text-3xs px-1.5 py-0.5 rounded bg-canvas border border-hairline text-secondary">
                                      {cls.category}
                                    </span>
                                  </td>
                                  <td className="py-2.5 px-3 text-secondary text-2xs max-w-xs truncate">
                                    {cls.description || '—'}
                                  </td>
                                  <td className="py-2.5 px-3">
                                    {cls.form_fields && cls.form_fields.length > 0 ? (
                                      <div className="flex flex-wrap gap-1 max-w-xs">
                                        {cls.form_fields.map((field) => (
                                          <span
                                            key={field.name}
                                            className="px-1.5 py-0.5 rounded text-3xs font-mono bg-canvas border border-hairline text-secondary"
                                          >
                                            {field.label}
                                          </span>
                                        ))}
                                      </div>
                                    ) : cls.attributes && cls.attributes.length > 0 ? (
                                      <div className="flex flex-wrap gap-1 max-w-xs">
                                        {cls.attributes.map((attr) => (
                                          <span
                                            key={attr}
                                            className="px-1.5 py-0.5 rounded text-3xs font-mono bg-canvas border border-hairline text-muted"
                                          >
                                            {attr}
                                          </span>
                                        ))}
                                      </div>
                                    ) : (
                                      <span className="text-muted text-3xs">Default</span>
                                    )}
                                  </td>
                                  <td className="py-2.5 px-3 font-mono text-2xs">
                                    {activeCIsCount > 0 ? (
                                      <Badge variant="neutral" className="text-3xs font-mono">
                                        {activeCIsCount} {activeCIsCount === 1 ? 'CI' : 'CIs'}
                                      </Badge>
                                    ) : (
                                      <span className="text-muted text-3xs">0 CIs</span>
                                    )}
                                  </td>
                                  <td className="py-2.5 px-3 text-right">
                                    <RowActionsMenu
                                      actions={[
                                        {
                                          label: 'Edit Class',
                                          icon: <Pencil className="w-3.5 h-3.5" />,
                                          onClick: () => handleOpenEditClass(cls),
                                        },
                                        {
                                          label: 'Delete Class',
                                          icon: <Trash2 className="w-3.5 h-3.5" />,
                                          variant: 'danger',
                                          title: activeCIsCount > 0 ? `Cannot delete: ${activeCIsCount} active CIs` : undefined,
                                          onClick: () => handleDeleteClass(cls),
                                        },
                                      ]}
                                    />
                                  </td>
                                </tr>
                              );
                            })
                          )}
                        </tbody>
                      </table>
                    </div>
                  </div>
                )}
              </CardContent>
            </Card>
          )}

          {/* Section B: Categories */}
          {adminSection === 'categories' && (
            <Card>
              <CardHeader className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-3">
                <div>
                  <CardTitle className="text-sm font-semibold flex items-center gap-2">
                    <Boxes className="w-4 h-4 text-accent" />
                    Operational Categories
                  </CardTitle>
                  <p className="text-2xs text-secondary mt-0.5">
                    Organize CI classes into top-level operational categories. Categories with assigned classes or active CIs are referentially protected.
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <div className="relative">
                    <Search className="w-3.5 h-3.5 text-muted absolute left-2 top-2" />
                    <Input
                      placeholder="Filter categories..."
                      value={categoryFilter}
                      onChange={(e) => setCategoryFilter(e.target.value)}
                      className="h-7.5 pl-7 text-xs w-48"
                    />
                  </div>
                  <Button
                    size="sm"
                    onClick={handleOpenCreateCategory}
                    className="gap-1.5 bg-accent hover:bg-accent-hover text-white text-xs shrink-0 cursor-pointer"
                  >
                    <Plus className="w-3.5 h-3.5" />
                    <span>Create Category</span>
                  </Button>
                </div>
              </CardHeader>
              <CardContent>
                {categoriesLoading ? (
                  <div className="py-8 text-center text-xs text-muted">Loading categories...</div>
                ) : (
                  <div className="border border-hairline rounded-md overflow-hidden bg-surface">
                    <div className="overflow-x-auto">
                      <table className="w-full text-xs text-left">
                        <thead className="bg-canvas border-b border-hairline font-mono text-3xs uppercase tracking-wider text-muted">
                          <tr>
                            <th className="py-2.5 px-3">Category</th>
                            <th className="py-2.5 px-3">Slug Key</th>
                            <th className="py-2.5 px-3">Description</th>
                            <th className="py-2.5 px-3">Color Accent</th>
                            <th className="py-2.5 px-3">Assigned Classes</th>
                            <th className="py-2.5 px-3">Active CIs</th>
                            <th className="py-2.5 px-3 text-right">Actions</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-subtle">
                          {filteredCategories.length === 0 ? (
                            <tr>
                              <td colSpan={7} className="py-6 text-center text-xs text-muted">
                                No categories found.
                              </td>
                            </tr>
                          ) : (
                            filteredCategories.map((cat) => {
                              const isReferenced = (cat.class_count || 0) > 0 || (cat.ci_count || 0) > 0;
                              return (
                                <tr key={cat.id} className="hover:bg-hover/60 transition-colors">
                                  <td className="py-2.5 px-3 font-semibold text-primary">
                                    <div className="flex items-center gap-2">
                                      <span className="p-1 rounded bg-canvas border border-hairline text-accent">
                                        {renderIcon(cat.icon || 'Boxes', 'w-3.5 h-3.5')}
                                      </span>
                                      <span>{cat.name}</span>
                                    </div>
                                  </td>
                                  <td className="py-2.5 px-3 font-mono text-secondary text-2xs">
                                    {cat.id}
                                  </td>
                                  <td className="py-2.5 px-3 text-secondary text-2xs max-w-xs truncate">
                                    {cat.description || '—'}
                                  </td>
                                  <td className="py-2.5 px-3">
                                    {renderColorBadge(getCategoryColor(cat))}
                                  </td>
                                  <td className="py-2.5 px-3 font-mono text-2xs">
                                    <Badge variant="neutral" className="text-3xs font-mono">
                                      {(cat.class_count || 0) === 1 ? '1 Class' : `${cat.class_count || 0} Classes`}
                                    </Badge>
                                  </td>
                                  <td className="py-2.5 px-3 font-mono text-2xs">
                                    {(cat.ci_count || 0) > 0 ? (
                                      <Badge variant="neutral" className="text-3xs font-mono">
                                        {(cat.ci_count || 0) === 1 ? '1 CI' : `${cat.ci_count} CIs`}
                                      </Badge>
                                    ) : (
                                      <span className="text-muted text-3xs font-mono">0 CIs</span>
                                    )}
                                  </td>
                                  <td className="py-2.5 px-3 text-right">
                                    <RowActionsMenu
                                      actions={[
                                        {
                                          label: 'Edit Category',
                                          icon: <Pencil className="w-3.5 h-3.5" />,
                                          onClick: () => handleOpenEditCategory(cat),
                                        },
                                        {
                                          label: 'Delete Category',
                                          icon: <Trash2 className="w-3.5 h-3.5" />,
                                          variant: 'danger',
                                          title: isReferenced ? 'Referentially protected' : undefined,
                                          onClick: () => handleDeleteCategory(cat),
                                        },
                                      ]}
                                    />
                                  </td>
                                </tr>
                              );
                            })
                          )}
                        </tbody>
                      </table>
                    </div>
                  </div>
                )}
              </CardContent>
            </Card>
          )}

          {/* Section C: Custom Relationships */}
          {adminSection === 'relationships' && (
            <Card>
              <CardHeader className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-3">
                <div>
                  <CardTitle className="text-sm font-semibold flex items-center gap-2">
                    <GitFork className="w-4 h-4 text-accent" />
                    Custom Relationships & Dependency Topology
                  </CardTitle>
                  <p className="text-2xs text-secondary mt-0.5">
                    Configure custom dependency semantics and reverse linkages. Relationships in active use by topology edges are referentially protected.
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <div className="relative">
                    <Search className="w-3.5 h-3.5 text-muted absolute left-2 top-2" />
                    <Input
                      placeholder="Filter relationships..."
                      value={relationshipFilter}
                      onChange={(e) => setRelationshipFilter(e.target.value)}
                      className="h-7.5 pl-7 text-xs w-48"
                    />
                  </div>
                  <Button
                    size="sm"
                    onClick={handleOpenCreateRelationship}
                    className="gap-1.5 bg-accent hover:bg-accent-hover text-white text-xs shrink-0 cursor-pointer"
                  >
                    <Plus className="w-3.5 h-3.5" />
                    <span>Create Relationship</span>
                  </Button>
                </div>
              </CardHeader>
              <CardContent>
                {relationshipsLoading ? (
                  <div className="py-8 text-center text-xs text-muted">Loading relationship types...</div>
                ) : (
                  <div className="border border-hairline rounded-md overflow-hidden bg-surface">
                    <div className="overflow-x-auto">
                      <table className="w-full text-xs text-left">
                        <thead className="bg-canvas border-b border-hairline font-mono text-3xs uppercase tracking-wider text-muted">
                          <tr>
                            <th className="py-2.5 px-3">Edge Type Key</th>
                            <th className="py-2.5 px-3">Relationship Type</th>
                            <th className="py-2.5 px-3">Reverse Relationship</th>
                            <th className="py-2.5 px-3">Description</th>
                            <th className="py-2.5 px-3">Color Accent</th>
                            <th className="py-2.5 px-3">Active Edges</th>
                            <th className="py-2.5 px-3 text-right">Actions</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-subtle">
                          {filteredRelationships.length === 0 ? (
                            <tr>
                              <td colSpan={7} className="py-6 text-center text-xs text-muted">
                                No relationship types found.
                              </td>
                            </tr>
                          ) : (
                            filteredRelationships.map((rel) => {
                              const hasEdges = (rel.edge_count || 0) > 0;
                              return (
                                <tr key={rel.id} className="hover:bg-hover/60 transition-colors">
                                  <td className="py-2.5 px-3 font-mono text-accent text-2xs font-semibold">
                                    <div className="flex items-center gap-2">
                                      <span className="p-1 rounded bg-canvas border border-hairline text-accent">
                                        <GitFork className="w-3.5 h-3.5" />
                                      </span>
                                      <span>{rel.id}</span>
                                    </div>
                                  </td>
                                  <td className="py-2.5 px-3 font-semibold text-primary">
                                    <span>{rel.label}</span>
                                  </td>
                                  <td className="py-2.5 px-3 text-secondary text-2xs font-mono">
                                    <span>{rel.reverse_label || '—'}</span>
                                  </td>
                                  <td className="py-2.5 px-3 text-secondary text-2xs max-w-xs truncate">
                                    {rel.description || '—'}
                                  </td>
                                  <td className="py-2.5 px-3">
                                    {renderColorBadge(rel.color || 'purple')}
                                  </td>
                                  <td className="py-2.5 px-3 font-mono text-2xs">
                                    {hasEdges ? (
                                      <Badge variant="warning" className="text-3xs font-mono">
                                        {rel.edge_count} Edges
                                      </Badge>
                                    ) : (
                                      <span className="text-muted text-3xs">0 Edges</span>
                                    )}
                                  </td>
                                  <td className="py-2.5 px-3 text-right">
                                    <RowActionsMenu
                                      actions={[
                                        {
                                          label: 'Edit Relationship',
                                          icon: <Pencil className="w-3.5 h-3.5" />,
                                          onClick: () => handleOpenEditRelationship(rel),
                                        },
                                        {
                                          label: 'Delete Relationship',
                                          icon: <Trash2 className="w-3.5 h-3.5" />,
                                          variant: 'danger',
                                          title: hasEdges ? `Cannot delete: ${rel.edge_count} active edges` : undefined,
                                          onClick: () => handleDeleteRelationship(rel),
                                        },
                                      ]}
                                    />
                                  </td>
                                </tr>
                              );
                            })
                          )}
                        </tbody>
                      </table>
                    </div>
                  </div>
                )}
              </CardContent>
            </Card>
          )}

          {/* Section D: Owner Groups */}
          {adminSection === 'groups' && (
            <Card>
              <CardHeader className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-3">
                <div>
                  <CardTitle className="text-sm font-semibold flex items-center gap-2">
                    <Building2 className="w-4 h-4 text-accent" />
                    Owner Groups & Boundaries
                  </CardTitle>
                  <p className="text-2xs text-secondary mt-0.5">
                    Manage organizational team boundaries, departments, and verification leads. Referentially protected when CIs or users belong to the group.
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <div className="relative">
                    <Search className="w-3.5 h-3.5 text-muted absolute left-2 top-2" />
                    <Input
                      placeholder="Filter groups..."
                      value={groupFilter}
                      onChange={(e) => setGroupFilter(e.target.value)}
                      className="h-7.5 pl-7 text-xs w-48"
                    />
                  </div>
                  <Button
                    size="sm"
                    onClick={handleOpenCreateGroup}
                    className="gap-1.5 bg-accent hover:bg-accent-hover text-white text-xs shrink-0 cursor-pointer"
                  >
                    <Plus className="w-3.5 h-3.5" />
                    <span>Create Owner Group</span>
                  </Button>
                </div>
              </CardHeader>
              <CardContent>
                {ownerGroupsLoading ? (
                  <div className="py-8 text-center text-xs text-muted">Loading owner groups...</div>
                ) : (
                  <div className="border border-hairline rounded-md overflow-hidden bg-surface">
                    <div className="overflow-x-auto">
                      <table className="w-full text-xs text-left">
                        <thead className="bg-canvas border-b border-hairline font-mono text-3xs uppercase tracking-wider text-muted">
                          <tr>
                            <th className="py-2.5 px-3">Owner Group</th>
                            <th className="py-2.5 px-3">Slug</th>
                            <th className="py-2.5 px-3">Department</th>
                            <th className="py-2.5 px-3">Team Lead</th>
                            <th className="py-2.5 px-3">Lead Email</th>
                            <th className="py-2.5 px-3 text-right">Actions</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-subtle">
                          {filteredOwnerGroups.length === 0 ? (
                            <tr>
                              <td colSpan={6} className="py-6 text-center text-xs text-muted">
                                No owner groups found.
                              </td>
                            </tr>
                          ) : (
                            filteredOwnerGroups.map((group) => (
                              <tr key={group.id} className="hover:bg-hover/60 transition-colors">
                                <td className="py-2.5 px-3 font-semibold text-primary">
                                  <div className="flex items-center gap-2">
                                    <span>{group.name}</span>
                                    {activeOwnerGroup?.id === group.id && (
                                      <Badge variant="success" className="text-3xs font-mono">
                                        Active
                                      </Badge>
                                    )}
                                  </div>
                                </td>
                                <td className="py-2.5 px-3 font-mono text-secondary text-2xs">
                                  {group.slug || '—'}
                                </td>
                                <td className="py-2.5 px-3 text-secondary text-2xs">
                                  {group.department_name}
                                </td>
                                <td className="py-2.5 px-3 text-primary text-xs font-medium">
                                  {group.team_lead_name}
                                </td>
                                <td className="py-2.5 px-3 font-mono text-secondary text-2xs">
                                  {group.team_lead_email}
                                </td>
                                <td className="py-2.5 px-3 text-right">
                                  <RowActionsMenu
                                    actions={[
                                      {
                                        label: 'Edit Group',
                                        icon: <Pencil className="w-3.5 h-3.5" />,
                                        onClick: () => handleOpenEditGroup(group),
                                      },
                                      {
                                        label: 'Delete Group',
                                        icon: <Trash2 className="w-3.5 h-3.5" />,
                                        variant: 'danger',
                                        onClick: () => handleDeleteGroup(group),
                                      },
                                    ]}
                                  />
                                </td>
                              </tr>
                            ))
                          )}
                        </tbody>
                      </table>
                    </div>
                  </div>
                )}
              </CardContent>
            </Card>
          )}
        </div>
      )}

      {/* 4. System & Diagnostics Tab */}
      {activeTab === 'system' && (
        <div className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <Card>
              <CardHeader>
                <CardTitle className="text-sm font-semibold flex items-center gap-2">
                  <Server className="w-4 h-4 text-accent" />
                  System Diagnostics
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-3 text-xs">
                <div className="flex items-center justify-between p-2 rounded bg-canvas border border-hairline">
                  <span className="text-secondary">Version</span>
                  <span className="font-mono font-semibold text-primary">v3.0.0 (Go 1.24 &bull; React 19)</span>
                </div>
                <div className="flex items-center justify-between p-2 rounded bg-canvas border border-hairline">
                  <span className="text-secondary">Database Engine</span>
                  <span className="font-mono font-semibold text-inservice flex items-center gap-1.5">
                    <CheckCircle2 className="w-3.5 h-3.5" /> PostgreSQL 16 (pgx/v5)
                  </span>
                </div>
                <div className="flex items-center justify-between p-2 rounded bg-canvas border border-hairline">
                  <span className="text-secondary">Signed in as</span>
                  <span className="font-mono text-primary text-2xs">{currentUser?.email || 'admin@enterprise.com'}</span>
                </div>
                <div className="flex items-center justify-between p-2 rounded bg-canvas border border-hairline">
                  <span className="text-secondary">Effective Role</span>
                  <span className="font-mono font-semibold text-accent uppercase text-3xs px-1.5 py-0.5 rounded bg-accent/15 border border-accent/30">
                    {currentUser?.role || 'platform_admin'}
                  </span>
                </div>
                <div className="pt-2">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setIsConfirmFlushOpen(true)}
                    disabled={clearingCache}
                    className="w-full gap-2 text-xs cursor-pointer"
                  >
                    <RefreshCw className={cn('w-3.5 h-3.5', clearingCache && 'animate-spin text-accent')} />
                    <span>{clearingCache ? 'Purging Cache...' : 'Flush Cache & Revalidate'}</span>
                  </Button>
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="text-sm font-semibold flex items-center gap-2">
                  <Building2 className="w-4 h-4 text-accent" />
                  Active Owner Boundaries
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-2 text-xs">
                <div className="space-y-1.5 max-h-96 overflow-y-auto pr-1">
                  {allOwnerGroups.map((group) => (
                    <div
                      key={group.id}
                      className={cn(
                        'flex items-center justify-between p-2.5 rounded border text-xs transition-colors',
                        activeOwnerGroup?.id === group.id
                          ? 'bg-selected border-accent/40 font-semibold text-primary shadow-xs'
                          : 'bg-canvas border-hairline text-secondary'
                      )}
                    >
                      <div>
                        <div className="font-medium text-primary flex items-center gap-2">
                          <span>{group.name}</span>
                          {activeOwnerGroup?.id === group.id && (
                            <Badge variant="success" className="text-3xs font-mono">Active Scope</Badge>
                          )}
                        </div>
                        <div className="text-3xs text-muted mt-0.5">
                          {group.department_name} &bull; Lead: {group.team_lead_name}
                        </div>
                      </div>
                      <span className="font-mono text-3xs text-muted bg-surface px-1.5 py-0.5 rounded border border-subtle">
                        {group.slug || group.id.slice(0, 8)}
                      </span>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          </div>

          {/* Pre-Seeded Developer Personas Card (Development Only) */}
          {import.meta.env.DEV && (
            <Card>
              <CardHeader>
                <CardTitle className="text-sm font-semibold flex items-center gap-2">
                  <Users className="w-4 h-4 text-accent" />
                  Pre-Seeded Developer Personas & RBAC Impersonation
                </CardTitle>
                <p className="text-2xs text-secondary mt-0.5">
                  Switch between enterprise developer personas to test granular permissions and data boundaries.
                </p>
              </CardHeader>
              <CardContent>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                  {DEV_USERS.map((devUser: DevUserOption) => {
                    const isActive = currentDevUserId === devUser.id;
                    return (
                      <div
                        key={devUser.id}
                        className={cn(
                          'p-3 rounded-lg border text-xs flex flex-col justify-between gap-3 transition-colors',
                          isActive
                            ? 'bg-selected/60 border-accent shadow-xs'
                            : 'bg-surface border-subtle hover:border-control'
                        )}
                      >
                        <div>
                          <div className="flex items-center justify-between">
                            <span className="font-semibold text-primary">{devUser.name}</span>
                            {isActive && (
                              <span className="text-3xs font-mono font-semibold px-1.5 py-0.5 rounded bg-accent text-white uppercase">
                                Active
                              </span>
                            )}
                          </div>
                          <div className="mt-1">
                            <span className="text-3xs font-mono uppercase px-1.5 py-0.5 rounded bg-surface-sunken border border-subtle text-secondary">
                              {devUser.role}
                            </span>
                          </div>
                          <div className="text-3xs text-muted mt-2">
                            <strong>Owner Group:</strong> {devUser.ownerGroupName}
                          </div>
                          <div className="text-3xs font-mono text-muted mt-0.5">
                            Header: {devUser.id}
                          </div>
                        </div>

                        <Button
                          size="sm"
                          variant={isActive ? 'outline' : 'primary'}
                          disabled={isActive}
                          onClick={() => {
                            switchDevUser(devUser);
                            toast.success(`Switched persona to ${devUser.name}`);
                          }}
                          className="w-full h-7 text-xs cursor-pointer"
                        >
                          {isActive ? 'Currently Active' : `Switch to ${devUser.name}`}
                        </Button>
                      </div>
                    );
                  })}
                </div>
              </CardContent>
            </Card>
          )}
        </div>
      )}

      {/* Confirmation Dialog: Flush Cache */}
      <Dialog open={isConfirmFlushOpen} onOpenChange={setIsConfirmFlushOpen}>
        <DialogContent variant="modal">
          <DialogHeader>
            <DialogTitle className="text-base font-semibold text-primary">
              Flush system cache?
            </DialogTitle>
            <DialogDescription className="text-xs text-secondary mt-1">
              This will invalidate all cached queries and reload data from the server.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setIsConfirmFlushOpen(false)}
            >
              Cancel
            </Button>
            <Button
              variant="primary"
              size="sm"
              onClick={async () => {
                setIsConfirmFlushOpen(false);
                await handleClearCache();
              }}
            >
              Flush cache
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Modal: Create New Custom Role */}
      <Dialog open={isRoleModalOpen} onOpenChange={setIsRoleModalOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle className="text-sm font-semibold flex items-center gap-2">
              <Shield className="w-4 h-4 text-accent" />
              Create Custom Role
            </DialogTitle>
          </DialogHeader>

          <form onSubmit={handleCreateRole} className="space-y-4 pt-2">
            {roleFormError && (
              <div className="p-2.5 rounded bg-tier0-bg border border-tier0-border text-tier0 text-xs flex items-center gap-2">
                <AlertCircle className="w-4 h-4 shrink-0" />
                <span>{roleFormError}</span>
              </div>
            )}

            <div className="space-y-1.5">
              <label className="text-2xs font-semibold uppercase tracking-wider text-muted font-mono">
                Role Name *
              </label>
              <Input
                value={newRoleName}
                onChange={(e) => setNewRoleName(e.target.value)}
                placeholder="e.g. SRE Topology Specialist"
                required
                className="h-8 text-xs font-sans"
              />
            </div>

            <div className="space-y-1.5">
              <label className="text-2xs font-semibold uppercase tracking-wider text-muted font-mono">
                Description
              </label>
              <Input
                value={newRoleDesc}
                onChange={(e) => setNewRoleDesc(e.target.value)}
                placeholder="Describe role responsibilities..."
                className="h-8 text-xs font-sans"
              />
            </div>

            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <label className="text-2xs font-semibold uppercase tracking-wider text-muted font-mono">
                  Granular Capability Matrix ({selectedPermissions.length} selected)
                </label>
              </div>

              <div className="border border-hairline rounded-md p-2 bg-canvas space-y-2 max-h-60 overflow-y-auto">
                {CAPABILITY_DEFINITIONS.map((cap) => {
                  const isChecked = selectedPermissions.includes(cap.key);
                  return (
                    <label
                      key={cap.key}
                      className={cn(
                        'flex items-start gap-2.5 p-2 rounded cursor-pointer transition-colors border text-left',
                        isChecked
                          ? 'bg-accent/10 border-accent/40 text-primary'
                          : 'bg-surface/50 border-subtle text-secondary hover:bg-hover'
                      )}
                    >
                      <input
                        type="checkbox"
                        checked={isChecked}
                        onChange={() => handleTogglePermission(cap.key)}
                        className="mt-0.5 rounded border-slate-600 text-accent focus:ring-accent cursor-pointer"
                      />
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center justify-between">
                          <span className="font-semibold text-xs text-primary">{cap.label}</span>
                          <span className="font-mono text-3xs px-1.5 py-0.5 rounded bg-surface border border-hairline text-muted">
                            {cap.key}
                          </span>
                        </div>
                        <p className="text-3xs text-muted mt-0.5">{cap.desc}</p>
                      </div>
                    </label>
                  );
                })}
              </div>
            </div>

            <DialogFooter className="pt-2">
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => setIsRoleModalOpen(false)}
                className="text-xs"
              >
                Cancel
              </Button>
              <Button
                type="submit"
                size="sm"
                disabled={createRoleMutation.isPending}
                className="bg-accent hover:bg-accent-hover text-white text-xs gap-1.5"
              >
                {createRoleMutation.isPending ? 'Saving...' : 'Create Role'}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* Modal: Register User */}
      <Dialog open={isUserModalOpen} onOpenChange={setIsUserModalOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="text-sm font-semibold flex items-center gap-2">
              <Users className="w-4 h-4 text-accent" />
              Register User Account
            </DialogTitle>
          </DialogHeader>

          <form onSubmit={handleCreateUser} className="space-y-3.5 pt-2">
            {userFormError && (
              <div className="p-2.5 rounded bg-tier0-bg border border-tier0-border text-tier0 text-xs flex items-center gap-2">
                <AlertCircle className="w-4 h-4 shrink-0" />
                <span>{userFormError}</span>
              </div>
            )}

            <div className="space-y-1">
              <label className="text-2xs font-semibold uppercase tracking-wider text-muted font-mono">
                Full Name *
              </label>
              <Input
                value={newUserName}
                onChange={(e) => setNewUserName(e.target.value)}
                placeholder="e.g. Jordan Miller"
                required
                className="h-8 text-xs font-sans"
              />
            </div>

            <div className="space-y-1">
              <label className="text-2xs font-semibold uppercase tracking-wider text-muted font-mono">
                Email Address *
              </label>
              <Input
                type="email"
                value={newUserEmail}
                onChange={(e) => setNewUserEmail(e.target.value)}
                placeholder="e.g. jordan.miller@enterprise.com"
                required
                className="h-8 text-xs font-mono"
              />
            </div>

            <div className="space-y-1">
              <label className="text-2xs font-semibold uppercase tracking-wider text-muted font-mono">
                Initial Password
              </label>
              <Input
                type="password"
                value={newUserPassword}
                onChange={(e) => setNewUserPassword(e.target.value)}
                placeholder="Leave blank for default (Admin123!)"
                className="h-8 text-xs font-mono"
              />
              <p className="text-3xs text-muted">Bcrypt-hashed and verified on sign in.</p>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <label className="text-2xs font-semibold uppercase tracking-wider text-muted font-mono">
                  Base System Role
                </label>
                <select
                  value={newUserRole}
                  onChange={(e) => setNewUserRole(e.target.value as any)}
                  className="w-full h-8 px-2 rounded bg-surface border border-hairline text-xs text-primary focus:border-accent focus:outline-none"
                >
                  <option value="team_lead">Team Lead</option>
                  <option value="platform_admin">Platform Admin</option>
                  <option value="viewer">Viewer</option>
                </select>
              </div>

              <div className="space-y-1">
                <label className="text-2xs font-semibold uppercase tracking-wider text-muted font-mono">
                  Status
                </label>
                <select
                  value={newUserStatus}
                  onChange={(e) => setNewUserStatus(e.target.value as any)}
                  className="w-full h-8 px-2 rounded bg-surface border border-hairline text-xs text-primary focus:border-accent focus:outline-none"
                >
                  <option value="active">Active</option>
                  <option value="suspended">Suspended</option>
                </select>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <label className="text-2xs font-semibold uppercase tracking-wider text-muted font-mono">
                  Custom Role
                </label>
                <select
                  value={newUserCustomRoleId}
                  onChange={(e) => setNewUserCustomRoleId(e.target.value)}
                  className="w-full h-8 px-2 rounded bg-surface border border-hairline text-xs text-primary focus:border-accent focus:outline-none"
                >
                  <option value="">(None / Default)</option>
                  {customRoles.map((r) => (
                    <option key={r.id} value={r.id}>
                      {r.name}
                    </option>
                  ))}
                </select>
              </div>

              <div className="space-y-1">
                <label className="text-2xs font-semibold uppercase tracking-wider text-muted font-mono">
                  Boundary Owner Group
                </label>
                <select
                  value={newUserGroupId}
                  onChange={(e) => setNewUserGroupId(e.target.value)}
                  className="w-full h-8 px-2 rounded bg-surface border border-hairline text-xs text-primary focus:border-accent focus:outline-none"
                >
                  <option value="">(Global / None)</option>
                  {allOwnerGroups.map((g) => (
                    <option key={g.id} value={g.id}>
                      {g.name}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            <DialogFooter className="pt-2">
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => setIsUserModalOpen(false)}
                className="text-xs"
              >
                Cancel
              </Button>
              <Button
                type="submit"
                size="sm"
                disabled={createUserMutation.isPending}
                className="bg-accent hover:bg-accent-hover text-white text-xs gap-1.5"
              >
                {createUserMutation.isPending ? 'Registering...' : 'Register User'}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* Modal: Edit User */}
      <Dialog open={isEditUserModalOpen} onOpenChange={setIsEditUserModalOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="text-sm font-semibold flex items-center gap-2">
              <Pencil className="w-4 h-4 text-accent" />
              Edit User Account
            </DialogTitle>
          </DialogHeader>

          <form onSubmit={handleSaveEditUser} className="space-y-3.5 pt-2">
            {editUserFormError && (
              <div className="p-2.5 rounded bg-tier0-bg border border-tier0-border text-tier0 text-xs flex items-center gap-2">
                <AlertCircle className="w-4 h-4 shrink-0" />
                <span>{editUserFormError}</span>
              </div>
            )}

            <div className="space-y-1">
              <label className="text-2xs font-semibold uppercase tracking-wider text-muted font-mono">
                Email Address
              </label>
              <Input
                value={editingUser?.email || ''}
                disabled
                className="h-8 text-xs font-mono bg-surface-sunken opacity-75 cursor-not-allowed"
              />
            </div>

            <div className="space-y-1">
              <label className="text-2xs font-semibold uppercase tracking-wider text-muted font-mono">
                Full Name *
              </label>
              <Input
                value={editUserName}
                onChange={(e) => setEditUserName(e.target.value)}
                required
                className="h-8 text-xs font-sans"
              />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <label className="text-2xs font-semibold uppercase tracking-wider text-muted font-mono">
                  Base System Role
                </label>
                <select
                  value={editUserRole}
                  onChange={(e) => setEditUserRole(e.target.value as any)}
                  className="w-full h-8 px-2 rounded bg-surface border border-hairline text-xs text-primary focus:border-accent focus:outline-none"
                >
                  <option value="team_lead">Team Lead</option>
                  <option value="platform_admin">Platform Admin</option>
                  <option value="viewer">Viewer</option>
                </select>
              </div>

              <div className="space-y-1">
                <label className="text-2xs font-semibold uppercase tracking-wider text-muted font-mono">
                  Status
                </label>
                <select
                  value={editUserStatus}
                  onChange={(e) => setEditUserStatus(e.target.value as any)}
                  className="w-full h-8 px-2 rounded bg-surface border border-hairline text-xs text-primary focus:border-accent focus:outline-none"
                >
                  <option value="active">Active</option>
                  <option value="suspended">Suspended</option>
                </select>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <label className="text-2xs font-semibold uppercase tracking-wider text-muted font-mono">
                  Custom Role
                </label>
                <select
                  value={editUserCustomRoleId}
                  onChange={(e) => setEditUserCustomRoleId(e.target.value)}
                  className="w-full h-8 px-2 rounded bg-surface border border-hairline text-xs text-primary focus:border-accent focus:outline-none"
                >
                  <option value="">(None / Default)</option>
                  {customRoles.map((r) => (
                    <option key={r.id} value={r.id}>
                      {r.name}
                    </option>
                  ))}
                </select>
              </div>

              <div className="space-y-1">
                <label className="text-2xs font-semibold uppercase tracking-wider text-muted font-mono">
                  Boundary Owner Group
                </label>
                <select
                  value={editUserGroupId}
                  onChange={(e) => setEditUserGroupId(e.target.value)}
                  className="w-full h-8 px-2 rounded bg-surface border border-hairline text-xs text-primary focus:border-accent focus:outline-none"
                >
                  <option value="">(Global / None)</option>
                  {allOwnerGroups.map((g) => (
                    <option key={g.id} value={g.id}>
                      {g.name}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            <DialogFooter className="pt-2">
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => setIsEditUserModalOpen(false)}
                className="text-xs"
              >
                Cancel
              </Button>
              <Button
                type="submit"
                size="sm"
                disabled={updateUserMutation.isPending}
                className="bg-accent hover:bg-accent-hover text-white text-xs gap-1.5"
              >
                {updateUserMutation.isPending ? 'Updating...' : 'Save Changes'}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* Modal: Reset Password */}
      <Dialog open={isResetPasswordModalOpen} onOpenChange={setIsResetPasswordModalOpen}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle className="text-sm font-semibold flex items-center gap-2">
              <Key className="w-4 h-4 text-accent" />
              Reset Password
            </DialogTitle>
          </DialogHeader>

          <form onSubmit={handleSaveResetPassword} className="space-y-3 pt-2">
            {resetPasswordError && (
              <div className="p-2.5 rounded bg-tier0-bg border border-tier0-border text-tier0 text-xs flex items-center gap-2">
                <AlertCircle className="w-4 h-4 shrink-0" />
                <span>{resetPasswordError}</span>
              </div>
            )}

            <div className="text-xs text-secondary">
              Resetting password for <strong className="text-primary">{resetUser?.name}</strong> ({resetUser?.email}).
            </div>

            <div className="space-y-1">
              <label className="text-2xs font-semibold uppercase tracking-wider text-muted font-mono">
                New Password *
              </label>
              <Input
                type="password"
                value={newPasswordInput}
                onChange={(e) => setNewPasswordInput(e.target.value)}
                placeholder="Enter new secure password"
                required
                className="h-8 text-xs font-mono"
              />
              <p className="text-3xs text-muted">Bcrypt hashed at cost 10.</p>
            </div>

            <DialogFooter className="pt-2">
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => setIsResetPasswordModalOpen(false)}
                className="text-xs"
              >
                Cancel
              </Button>
              <Button
                type="submit"
                size="sm"
                disabled={resetPasswordMutation.isPending}
                className="bg-cyan-600 hover:bg-cyan-500 text-white text-xs gap-1.5"
              >
                {resetPasswordMutation.isPending ? 'Resetting...' : 'Set Password'}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* Modal: Create/Edit Category */}
      <Dialog open={isCategoryModalOpen} onOpenChange={setIsCategoryModalOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="text-sm font-semibold flex items-center gap-2">
              <Boxes className="w-4 h-4 text-accent" />
              {editingCategory ? `Edit Category: ${editingCategory.name}` : 'Create Operational Category'}
            </DialogTitle>
          </DialogHeader>

          <form onSubmit={handleSaveCategory} className="space-y-3 pt-2">
            {catFormError && (
              <div className="p-2.5 rounded bg-tier0-bg border border-tier0-border text-tier0 text-xs flex items-center gap-2">
                <AlertCircle className="w-4 h-4 shrink-0" />
                <span>{catFormError}</span>
              </div>
            )}

            <div className="space-y-1">
              <label className="text-2xs font-semibold uppercase tracking-wider text-muted font-mono">
                Category Name *
              </label>
              <Input
                value={catName}
                onChange={(e) => {
                  setCatName(e.target.value);
                  if (!editingCategory && (!catId || catId === catName.toLowerCase().replace(/[^a-z0-9_]/g, '_'))) {
                    setCatId(e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, '_'));
                  }
                }}
                placeholder="e.g. Cloud Services"
                required
                className="h-8 text-xs font-sans"
              />
            </div>

            <div className="space-y-1">
              <label className="text-2xs font-semibold uppercase tracking-wider text-muted font-mono">
                Category Identifier / Slug *
              </label>
              <Input
                value={catId}
                onChange={(e) => setCatId(e.target.value)}
                placeholder="e.g. cloud_services"
                disabled={!!editingCategory}
                required
                className="h-8 text-xs font-mono"
              />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <label className="text-2xs font-semibold uppercase tracking-wider text-muted font-mono">
                  Icon
                </label>
                <select
                  value={catIcon}
                  onChange={(e) => setCatIcon(e.target.value)}
                  className="w-full h-8 px-2 rounded bg-surface border border-hairline text-xs text-primary focus:border-accent focus:outline-none"
                >
                  <option value="Boxes">Boxes (Generic)</option>
                  <option value="Layers">Layers (Service)</option>
                  <option value="Cpu">Cpu (Application)</option>
                  <option value="Database">Database (Data)</option>
                  <option value="Server">Server (Infrastructure)</option>
                  <option value="HardDrive">HardDrive (Storage)</option>
                  <option value="Network">Network (Connectivity)</option>
                  <option value="Cloud">Cloud (Public Cloud)</option>
                  <option value="Shield">Shield (Security/Compliance)</option>
                </select>
              </div>

              <div className="space-y-1">
                <label className="text-2xs font-semibold uppercase tracking-wider text-muted font-mono">
                  Color Accent
                </label>
                <select
                  value={catColor}
                  onChange={(e) => setCatColor(e.target.value)}
                  className="w-full h-8 px-2 rounded bg-surface border border-hairline text-xs text-primary focus:border-accent focus:outline-none"
                >
                  {COLOR_OPTIONS.map((c) => (
                    <option key={c.value} value={c.value}>
                      {c.label}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            <div className="space-y-1">
              <label className="text-2xs font-semibold uppercase tracking-wider text-muted font-mono">
                Description
              </label>
              <Input
                value={catDesc}
                onChange={(e) => setCatDesc(e.target.value)}
                placeholder="Operational purpose of this category..."
                className="h-8 text-xs font-sans"
              />
            </div>

            <DialogFooter className="pt-2">
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => setIsCategoryModalOpen(false)}
                className="text-xs"
              >
                Cancel
              </Button>
              <Button
                type="submit"
                size="sm"
                disabled={createCategoryMutation.isPending || updateCategoryMutation.isPending}
                className="bg-accent hover:bg-accent-hover text-white text-xs gap-1.5"
              >
                {createCategoryMutation.isPending || updateCategoryMutation.isPending
                  ? 'Saving...'
                  : editingCategory
                  ? 'Update Category'
                  : 'Create Category'}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* Modal: Create/Edit Relationship Type */}
      <Dialog open={isRelationshipModalOpen} onOpenChange={setIsRelationshipModalOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="text-sm font-semibold flex items-center gap-2">
              <GitFork className="w-4 h-4 text-accent" />
              {editingRelationship ? `Edit Relationship: ${editingRelationship.label}` : 'Create Custom Relationship'}
            </DialogTitle>
          </DialogHeader>

          <form onSubmit={handleSaveRelationship} className="space-y-3 pt-2">
            {relFormError && (
              <div className="p-2.5 rounded bg-tier0-bg border border-tier0-border text-tier0 text-xs flex items-center gap-2">
                <AlertCircle className="w-4 h-4 shrink-0" />
                <span>{relFormError}</span>
              </div>
            )}

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <label className="text-2xs font-semibold uppercase tracking-wider text-muted font-mono">
                  Edge Type Key *
                </label>
                <Input
                  value={relId}
                  onChange={(e) => {
                    const key = e.target.value;
                    setRelId(key);
                    if (!editingRelationship && (!relLabel || relLabel === relId.replace(/_/g, ' ').replace(/\b\w/g, (l) => l.toUpperCase()))) {
                      setRelLabel(key.replace(/_/g, ' ').replace(/\b\w/g, (l) => l.toUpperCase()));
                    }
                  }}
                  placeholder="e.g. replicates_to"
                  disabled={!!editingRelationship}
                  required
                  className="h-8 text-xs font-mono"
                />
              </div>

              <div className="space-y-1">
                <label className="text-2xs font-semibold uppercase tracking-wider text-muted font-mono">
                  Relationship Type *
                </label>
                <Input
                  value={relLabel}
                  onChange={(e) => {
                    setRelLabel(e.target.value);
                    if (!editingRelationship && (!relId || relId === relLabel.toLowerCase().replace(/[^a-z0-9_]/g, '_'))) {
                      setRelId(e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, '_'));
                    }
                  }}
                  placeholder="e.g. Replicates To"
                  required
                  className="h-8 text-xs font-sans"
                />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <label className="text-2xs font-semibold uppercase tracking-wider text-muted font-mono">
                  Reverse Relationship
                </label>
                <Input
                  value={relReverseLabel}
                  onChange={(e) => setRelReverseLabel(e.target.value)}
                  placeholder="e.g. Replicated From"
                  className="h-8 text-xs font-sans"
                />
              </div>

              <div className="space-y-1">
                <label className="text-2xs font-semibold uppercase tracking-wider text-muted font-mono">
                  Visual Color Accent
                </label>
                <select
                  value={relColor}
                  onChange={(e) => setRelColor(e.target.value)}
                  className="w-full h-8 px-2 rounded bg-surface border border-hairline text-xs text-primary focus:border-accent focus:outline-none"
                >
                  {COLOR_OPTIONS.map((c) => (
                    <option key={c.value} value={c.value}>
                      {c.label}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            <div className="space-y-1">
              <label className="text-2xs font-semibold uppercase tracking-wider text-muted font-mono">
                Description
              </label>
              <Input
                value={relDesc}
                onChange={(e) => setRelDesc(e.target.value)}
                placeholder="Semantic dependency meaning (e.g. real-time CDC replication channel)..."
                className="h-8 text-xs font-sans"
              />
            </div>

            <DialogFooter className="pt-2">
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => setIsRelationshipModalOpen(false)}
                className="text-xs"
              >
                Cancel
              </Button>
              <Button
                type="submit"
                size="sm"
                disabled={createRelationshipMutation.isPending || updateRelationshipMutation.isPending}
                className="bg-accent hover:bg-accent-hover text-white text-xs gap-1.5"
              >
                {createRelationshipMutation.isPending || updateRelationshipMutation.isPending
                  ? 'Saving...'
                  : editingRelationship
                  ? 'Update Relationship'
                  : 'Create Relationship'}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* Modal: Create/Edit Owner Group */}
      <Dialog open={isOwnerGroupModalOpen} onOpenChange={setIsOwnerGroupModalOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="text-sm font-semibold flex items-center gap-2">
              <Building2 className="w-4 h-4 text-accent" />
              {editingOwnerGroup ? 'Edit Owner Group' : 'Create Owner Group'}
            </DialogTitle>
          </DialogHeader>

          <form onSubmit={handleSaveGroup} className="space-y-3 pt-2">
            {groupFormError && (
              <div className="p-2.5 rounded bg-tier0-bg border border-tier0-border text-tier0 text-xs flex items-center gap-2">
                <AlertCircle className="w-4 h-4 shrink-0" />
                <span>{groupFormError}</span>
              </div>
            )}

            <div className="space-y-1">
              <label className="text-2xs font-semibold uppercase tracking-wider text-muted font-mono">
                Group Name *
              </label>
              <Input
                value={groupName}
                onChange={(e) => setGroupName(e.target.value)}
                placeholder="e.g. Data Platform"
                required
                className="h-8 text-xs font-sans"
              />
            </div>

            <div className="space-y-1">
              <label className="text-2xs font-semibold uppercase tracking-wider text-muted font-mono">
                Department Name *
              </label>
              <Input
                value={groupDepartment}
                onChange={(e) => setGroupDepartment(e.target.value)}
                placeholder="e.g. Analytics & Core Data"
                required
                className="h-8 text-xs font-sans"
              />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <label className="text-2xs font-semibold uppercase tracking-wider text-muted font-mono">
                  Team Lead Name *
                </label>
                <Input
                  value={groupLeadName}
                  onChange={(e) => setGroupLeadName(e.target.value)}
                  placeholder="e.g. Taylor Morgan"
                  required
                  className="h-8 text-xs font-sans"
                />
              </div>

              <div className="space-y-1">
                <label className="text-2xs font-semibold uppercase tracking-wider text-muted font-mono">
                  Team Lead Email *
                </label>
                <Input
                  type="email"
                  value={groupLeadEmail}
                  onChange={(e) => setGroupLeadEmail(e.target.value)}
                  placeholder="e.g. taylor@enterprise.com"
                  required
                  className="h-8 text-xs font-mono"
                />
              </div>
            </div>

            <div className="space-y-1">
              <label className="text-2xs font-semibold uppercase tracking-wider text-muted font-mono">
                Slug (Optional)
              </label>
              <Input
                value={groupSlug}
                onChange={(e) => setGroupSlug(e.target.value)}
                placeholder="e.g. data-platform (auto-derived if blank)"
                className="h-8 text-xs font-mono"
              />
            </div>

            <DialogFooter className="pt-2">
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => setIsOwnerGroupModalOpen(false)}
                className="text-xs"
              >
                Cancel
              </Button>
              <Button
                type="submit"
                size="sm"
                disabled={createOwnerGroupMutation.isPending || updateOwnerGroupMutation.isPending}
                className="bg-accent hover:bg-accent-hover text-white text-xs gap-1.5"
              >
                {createOwnerGroupMutation.isPending || updateOwnerGroupMutation.isPending
                  ? 'Saving...'
                  : editingOwnerGroup
                  ? 'Update Group'
                  : 'Create Group'}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* Modal: Create/Edit CI Class with Dynamic Form Builder */}
      <Dialog open={isClassModalOpen} onOpenChange={setIsClassModalOpen}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <div className="flex items-center justify-between">
              <DialogTitle className="text-sm font-semibold flex items-center gap-2">
                <Layers className="w-4 h-4 text-accent" />
                {editingClass ? `Edit CI Class: ${editingClass.label}` : 'Create Custom CI Class'}
              </DialogTitle>
              {!editingClass && (
                <div className="flex items-center gap-1.5 text-2xs">
                  <span className="text-muted font-mono">Templates:</span>
                  <button
                    type="button"
                    onClick={() => applyFormTemplate('vm_server')}
                    className="px-2 py-0.5 rounded bg-surface-sunken text-secondary border border-subtle hover:bg-hover hover:text-primary transition-colors font-mono cursor-pointer"
                  >
                    VM Server
                  </button>
                  <button
                    type="button"
                    onClick={() => applyFormTemplate('database')}
                    className="px-2 py-0.5 rounded bg-surface-sunken text-secondary border border-subtle hover:bg-hover hover:text-primary transition-colors font-mono cursor-pointer"
                  >
                    Database
                  </button>
                  <button
                    type="button"
                    onClick={() => applyFormTemplate('microservice')}
                    className="px-2 py-0.5 rounded bg-surface-sunken text-secondary border border-subtle hover:bg-hover hover:text-primary transition-colors font-mono cursor-pointer"
                  >
                    Microservice
                  </button>
                </div>
              )}
            </div>
          </DialogHeader>

          <form onSubmit={handleSaveClass} className="space-y-4 pt-2">
            {classFormError && (
              <div className="p-2.5 rounded bg-tier0-bg border border-tier0-border text-tier0 text-xs flex items-center gap-2">
                <AlertCircle className="w-4 h-4 shrink-0" />
                <span>{classFormError}</span>
              </div>
            )}

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <label htmlFor="modal-class-key" className="text-2xs font-semibold uppercase tracking-wider text-muted font-mono">
                  Class Key / ID *
                </label>
                <Input
                  id="modal-class-key"
                  value={classKey}
                  onChange={(e) => setClassKey(e.target.value)}
                  placeholder="e.g. vm_server"
                  disabled={!!editingClass}
                  required
                  className="h-8 text-xs font-mono"
                />
              </div>

              <div className="space-y-1">
                <label htmlFor="modal-class-label" className="text-2xs font-semibold uppercase tracking-wider text-muted font-mono">
                  Display Label *
                </label>
                <Input
                  id="modal-class-label"
                  value={classLabel}
                  onChange={(e) => setClassLabel(e.target.value)}
                  placeholder="e.g. VM Server"
                  required
                  className="h-8 text-xs font-sans"
                />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <label htmlFor="modal-class-category" className="text-2xs font-semibold uppercase tracking-wider text-muted font-mono">
                  Operational Category *
                </label>
                <select
                  id="modal-class-category"
                  value={classCategory}
                  onChange={(e) => setClassCategory(e.target.value)}
                  className="w-full h-8 px-2 rounded bg-surface border border-hairline text-xs text-primary focus:border-accent focus:outline-none"
                >
                  {categories.map((cat) => (
                    <option key={cat.id} value={cat.name}>
                      {cat.name}
                    </option>
                  ))}
                </select>
              </div>

              <div className="space-y-1">
                <label htmlFor="modal-class-icon" className="text-2xs font-semibold uppercase tracking-wider text-muted font-mono">
                  Icon
                </label>
                <select
                  id="modal-class-icon"
                  value={classIcon}
                  onChange={(e) => setClassIcon(e.target.value)}
                  className="w-full h-8 px-2 rounded bg-surface border border-hairline text-xs text-primary focus:border-accent focus:outline-none"
                >
                  <option value="Layers">Layers (Service)</option>
                  <option value="Cpu">Cpu (Application)</option>
                  <option value="Database">Database (Data)</option>
                  <option value="Server">Server (Compute / VM)</option>
                  <option value="HardDrive">HardDrive (Host)</option>
                  <option value="Network">Network (Firewall)</option>
                  <option value="Radio">Radio (Queue/Broker)</option>
                  <option value="Workflow">Workflow (Pipeline)</option>
                  <option value="Boxes">Boxes (Containers)</option>
                  <option value="Cloud">Cloud (Cloud Service)</option>
                  <option value="Shield">Shield (Security/WAF)</option>
                </select>
              </div>
            </div>

            <div className="space-y-1">
              <label htmlFor="modal-class-description" className="text-2xs font-semibold uppercase tracking-wider text-muted font-mono">
                Description
              </label>
              <Input
                id="modal-class-description"
                value={classDescription}
                onChange={(e) => setClassDescription(e.target.value)}
                placeholder="Describe this class's operational role..."
                className="h-8 text-xs font-sans"
              />
            </div>

            {/* Dynamic Form Field Builder Section */}
            <div className="pt-2 border-t border-hairline space-y-3">
              <div className="flex items-center justify-between">
                <div>
                  <label className="text-2xs font-semibold uppercase tracking-wider text-accent font-mono flex items-center gap-1.5">
                    <Sliders className="w-3.5 h-3.5" />
                    <span>Dynamic CI Creation Form Fields</span>
                  </label>
                  <p className="text-3xs text-secondary mt-0.5">
                    Define the form fields required when engineers create a CI of this class (e.g. Server Name, IP, OS, Memory, Storage)
                  </p>
                </div>
                {!isAddingField && (
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    onClick={() => {
                      setFieldName('');
                      setFieldLabel('');
                      setFieldType('text');
                      setFieldRequired(true);
                      setFieldPlaceholder('');
                      setFieldOptions('');
                      setFieldDefault('');
                      setIsAddingField(true);
                    }}
                    className="h-7 px-2 text-3xs gap-1 text-accent border-accent/40 cursor-pointer"
                  >
                    <Plus className="w-3 h-3" />
                    <span>Add Field</span>
                  </Button>
                )}
              </div>

              {/* In-progress New Field Sub-form */}
              {isAddingField && (
                <div className="p-3 rounded-lg bg-surface-sunken/80 border border-accent/40 space-y-3 animate-in fade-in-50 duration-150">
                  <div className="flex items-center justify-between">
                    <span className="text-2xs font-mono font-semibold text-accent uppercase tracking-wider">
                      New Form Field Specification
                    </span>
                    <button
                      type="button"
                      onClick={() => setIsAddingField(false)}
                      className="text-muted hover:text-primary p-0.5"
                    >
                      <X className="w-3.5 h-3.5" />
                    </button>
                  </div>

                  <div className="grid grid-cols-2 gap-2.5">
                    <div className="space-y-1">
                      <label className="text-3xs font-mono text-muted uppercase">Field Label *</label>
                      <Input
                        value={fieldLabel}
                        onChange={(e) => {
                          setFieldLabel(e.target.value);
                          if (!fieldName || fieldName === fieldLabel.toLowerCase().replace(/[^a-z0-9_]/g, '_')) {
                            setFieldName(e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, '_'));
                          }
                        }}
                        placeholder="e.g. Memory Size"
                        required
                        className="h-7.5 text-xs font-sans"
                      />
                    </div>

                    <div className="space-y-1">
                      <label className="text-3xs font-mono text-muted uppercase">Field Key / Name *</label>
                      <Input
                        value={fieldName}
                        onChange={(e) => setFieldName(e.target.value)}
                        placeholder="e.g. memory_size"
                        required
                        className="h-7.5 text-xs font-mono"
                      />
                    </div>
                  </div>

                  <div className="grid grid-cols-3 gap-2.5">
                    <div className="space-y-1">
                      <label className="text-3xs font-mono text-muted uppercase">Type</label>
                      <select
                        value={fieldType}
                        onChange={(e) => setFieldType(e.target.value as any)}
                        className="w-full h-7.5 px-2 rounded bg-surface border border-hairline text-xs text-primary focus:border-accent focus:outline-none"
                      >
                        <option value="text">Text (String)</option>
                        <option value="number">Number</option>
                        <option value="select">Dropdown Select</option>
                        <option value="boolean">Boolean Toggle</option>
                      </select>
                    </div>

                    <div className="space-y-1">
                      <label className="text-3xs font-mono text-muted uppercase">Placeholder</label>
                      <Input
                        value={fieldPlaceholder}
                        onChange={(e) => setFieldPlaceholder(e.target.value)}
                        placeholder="e.g. 64 GB"
                        className="h-7.5 text-xs font-mono"
                      />
                    </div>

                    <div className="space-y-1 flex flex-col justify-end">
                      <label className="flex items-center gap-2 cursor-pointer h-7.5">
                        <input
                          type="checkbox"
                          checked={fieldRequired}
                          onChange={(e) => setFieldRequired(e.target.checked)}
                          className="w-3.5 h-3.5 rounded text-accent bg-surface border-hairline"
                        />
                        <span className="text-xs text-primary font-medium">Mandatory Field</span>
                      </label>
                    </div>
                  </div>

                  {fieldType === 'select' && (
                    <div className="space-y-1">
                      <label className="text-3xs font-mono text-muted uppercase">
                        Select Options (Comma-separated) *
                      </label>
                      <Input
                        value={fieldOptions}
                        onChange={(e) => setFieldOptions(e.target.value)}
                        placeholder="e.g. Ubuntu 22.04 LTS, Debian 12, RHEL 9, Windows Server 2022"
                        className="h-7.5 text-xs font-mono"
                      />
                    </div>
                  )}

                  <div className="flex items-center justify-end gap-2 pt-1 border-t border-subtle">
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      onClick={() => setIsAddingField(false)}
                      className="h-7 px-2.5 text-xs"
                    >
                      Cancel
                    </Button>
                    <Button
                      type="button"
                      size="sm"
                      onClick={handleAddField}
                      disabled={!fieldName.trim() || !fieldLabel.trim()}
                      className="h-7 px-3 text-xs bg-accent hover:bg-accent-hover text-white gap-1"
                    >
                      <Check className="w-3 h-3" />
                      <span>Save Field</span>
                    </Button>
                  </div>
                </div>
              )}

              {/* Form Fields List */}
              {classFormFields.length === 0 ? (
                <div className="p-4 rounded-lg border border-dashed border-hairline text-center text-xs text-muted">
                  No custom form fields configured for this CI class.
                  Click <strong className="text-accent cursor-pointer" onClick={() => setIsAddingField(true)}>+ Add Field</strong> or use a template above to generate fields.
                </div>
              ) : (
                <div className="space-y-1.5 border border-hairline rounded-md overflow-hidden bg-surface">
                  <div className="divide-y divide-subtle">
                    {classFormFields.map((field) => (
                      <div
                        key={field.name}
                        className="p-2.5 flex items-center justify-between text-xs hover:bg-hover/40 transition-colors"
                      >
                        <div className="flex items-center gap-2.5 min-w-0">
                          <span className="font-semibold text-primary">{field.label}</span>
                          <span className="text-3xs font-mono text-accent bg-accent-subtle px-1.5 py-0.5 rounded border border-accent/30 font-semibold">
                            {field.name}
                          </span>
                          <span className="text-3xs font-mono text-secondary px-1.5 py-0.5 rounded bg-canvas border border-hairline uppercase">
                            {field.type}
                          </span>
                          {field.required && (
                            <span className="text-3xs font-mono text-tier0 bg-tier0-bg px-1.5 py-0.5 rounded border border-tier0-border font-semibold">
                              Required
                            </span>
                          )}
                          {field.placeholder && (
                            <span className="text-3xs text-muted truncate max-w-[150px] font-mono">
                              "{field.placeholder}"
                            </span>
                          )}
                          {field.options && field.options.length > 0 && (
                            <span className="text-3xs text-secondary truncate max-w-[180px]">
                              Options: {field.options.join(', ')}
                            </span>
                          )}
                        </div>

                        <button
                          type="button"
                          onClick={() => handleRemoveField(field.name)}
                          className="text-muted hover:text-tier0 p-1 rounded transition-colors cursor-pointer shrink-0"
                          title="Remove field"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>

            <DialogFooter className="pt-3 border-t border-hairline">
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => setIsClassModalOpen(false)}
                className="text-xs"
              >
                Cancel
              </Button>
              <Button
                type="submit"
                size="sm"
                disabled={createClassMutation.isPending || updateClassMutation.isPending}
                className="bg-accent hover:bg-accent-hover text-white text-xs gap-1.5"
              >
                {createClassMutation.isPending || updateClassMutation.isPending
                  ? 'Saving...'
                  : editingClass
                  ? 'Update Class'
                  : 'Create Class'}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* Global Unified Confirm Delete Dialog with Referential Safety Enforcement */}
      <ConfirmDeleteDialog
        open={deleteConfirm.open}
        onOpenChange={(open) => setDeleteConfirm((prev) => ({ ...prev, open }))}
        title={deleteConfirm.title}
        description={deleteConfirm.description}
        itemName={deleteConfirm.itemName}
        itemType={deleteConfirm.itemType}
        isBlocked={deleteConfirm.isBlocked}
        blockReason={deleteConfirm.blockReason}
        blockingMetrics={deleteConfirm.blockingMetrics}
        onConfirm={deleteConfirm.onConfirm}
        isLoading={deleteConfirm.isLoading}
      />
    </div>
  );
}

export default SettingsView;
